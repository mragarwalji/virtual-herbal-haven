
import io
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import tensorflow as tf
import requests

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent

load_dotenv(ROOT.parent / ".env")
PLANTNET_API_KEY = os.getenv("PLANTNET_API_KEY")

MODEL_DIR = ROOT.parent / "dl" / "artifacts_v2"
MODEL_PATH = MODEL_DIR / "species_classifier.keras"
LABELS_PATH = MODEL_DIR / "species_classifier_labels.json"

model = None
class_names = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, class_names

    print("Loading V2 plant classifier...")

    model = tf.keras.models.load_model(MODEL_PATH)

    with open(LABELS_PATH, "r") as f:
        class_names = json.load(f)

    print("Model loaded successfully!")
    print("Classes:", class_names)

    yield


app = FastAPI(
    title="Virtual Herbal Garden Plant API",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://192.168.29.183:8080",
        "https://vanvidya-6390d.web.app",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)



@app.get("/health")
def health():
    return {
        "status": "ok",
        "classifier_ready": model is not None,
        "classes": class_names,
    }


@app.post("/identify")
async def identify(image: UploadFile = File(...)):

    if model is None:
        raise HTTPException(
            status_code=503,
            detail="Plant classifier is not ready.",
        )

    if image.content_type not in (
        "image/jpeg",
        "image/png",
        "image/webp",
    ):
        raise HTTPException(
            status_code=415,
            detail="Upload JPG, PNG or WebP image.",
        )

    raw = await image.read(8 * 1024 * 1024 + 1)

    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Maximum image size is 8 MB.",
        )

    try:
        picture = Image.open(io.BytesIO(raw))
        picture.verify()

        picture = Image.open(io.BytesIO(raw))
        picture = ImageOps.exif_transpose(picture)
        picture = picture.convert("RGB")
        picture = picture.resize(
            (224, 224),
            Image.Resampling.BILINEAR,
        )

    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Invalid image file.",
        )

    x = np.asarray(
        picture,
        dtype=np.float32,
    )[None, ...]

    probabilities = model.predict(x, verbose=0)[0]

    index = int(np.argmax(probabilities))

    predicted_label = class_names[index]
    confidence = float(probabilities[index])

    return {
        "status": "predicted",
        "scientific_name": predicted_label,
        "common_name": predicted_label.replace("_", " "),
        "confidence": confidence,
        "message": (
            "AI prediction only. The model recognizes "
            "Aloe Vera, Neem and Tulsi; other plants may "
            "be incorrectly classified."
        ),
        "saved": False,
    }

@app.post("/identify-external")
async def identify_external(image: UploadFile = File(...)):

    if not PLANTNET_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Pl@ntNet API key is not configured.",
        )

    if image.content_type not in (
        "image/jpeg",
        "image/png",
        "image/webp",
    ):
        raise HTTPException(
            status_code=415,
            detail="Upload JPG, PNG or WebP image.",
        )

    raw = await image.read(8 * 1024 * 1024 + 1)

    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Maximum image size is 8 MB.",
        )

    try:
        picture = Image.open(io.BytesIO(raw))
        picture.verify()

        picture = Image.open(io.BytesIO(raw))
        picture = ImageOps.exif_transpose(picture)
        picture = picture.convert("RGB")

        buffer = io.BytesIO()
        picture.save(buffer, format="JPEG", quality=90)
        image_bytes = buffer.getvalue()

    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Invalid image file.",
        )

    try:
        response = requests.post(
            "https://my-api.plantnet.org/v2/identify/all",
            params={"api-key": PLANTNET_API_KEY},
            files={
                "images": (
                    "plant.jpg",
                    image_bytes,
                    "image/jpeg",
                )
            },
            data={"organs": "auto"},
            timeout=30,
        )

    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="Plant identification service is unavailable.",
        )

    if response.status_code == 404:
        return {
            "status": "not_identified",
            "message": "No reliable plant identification found.",
            "saved": False,
        }

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Plant identification API returned status {response.status_code}.",
        )

    data = response.json()
    results = data.get("results", [])

    if not results:
        return {
            "status": "not_identified",
            "message": "Plant could not be identified.",
            "saved": False,
        }

    best = results[0]
    species = best.get("species", {})

    scientific_name = species.get(
        "scientificNameWithoutAuthor",
        species.get("scientificName", ""),
    )

    common_names = species.get("commonNames", [])
    common_name = (
        common_names[0]
        if common_names
        else scientific_name
    )

    confidence = float(best.get("score", 0))

    if confidence < 0.5:
        return {
            "status": "not_identified",
            "scientific_name": None,
            "common_name": None,
            "confidence": confidence,
            "message": (
                "Plant could not be identified reliably. "
                "Please upload a clearer photo showing "
                "the leaves or flowers."
            ),
            "saved": False,
        }

    return {
        "status": (
            "identified"
            if confidence >= 0.5
            else "uncertain"
        ),
        "scientific_name": scientific_name,
        "common_name": common_name,
        "confidence": confidence,
        "message": (
            "Possible plant identification from Pl@ntNet."
            if confidence >= 0.5
            else "Low-confidence suggestion. Please verify the species."
        ),
        "saved": False,
    }



HINDI_PLANT_NAMES = {
    "withania somnifera": "अश्वगंधा",
    "aloe vera": "घृतकुमारी (ग्वारपाठा)",
    "azadirachta indica": "नीम",
    "ocimum tenuiflorum": "तुलसी",
    "ocimum sanctum": "तुलसी",
    "phyllanthus emblica": "आंवला",
    "emblica officinalis": "आंवला",
    "hibiscus rosa-sinensis": "गुड़हल",
}

PLANT_DETAILS = {
    "withania somnifera": {
        "about": (
            "Ashwagandha is a medicinal shrub traditionally "
            "used in Ayurveda. It belongs to the Solanaceae family."
        ),
        "growing_conditions": (
            "Grows in warm climates, prefers well-drained soil "
            "and generally does well in sunny conditions."
        ),
    },
    "aloe vera": {
        "about": (
            "Aloe vera is a succulent plant known for its "
            "fleshy leaves containing a gel."
        ),
        "growing_conditions": (
            "Prefers bright light, well-drained soil "
            "and infrequent watering."
        ),
    },
    "azadirachta indica": {
        "about": (
            "Neem is an evergreen tree native to the "
            "Indian subcontinent, traditionally valued "
            "for various uses."
        ),
        "growing_conditions": (
            "Prefers warm climates, plenty of sunlight "
            "and well-drained soil."
        ),
    },
    "phyllanthus emblica": {
        "about": (
            "Amla, also known as Indian gooseberry, "
            "is a tree valued for its vitamin C-rich fruit."
        ),
        "growing_conditions": (
            "Grows in tropical and subtropical climates "
            "and prefers well-drained soil."
        ),
    },
}

def get_dynamic_hindi_name(scientific_name: str):
    try:
        response = requests.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbsearchentities",
                "search": scientific_name,
                "language": "en",
                "format": "json",
                "limit": 5,
            },
            headers={
                "User-Agent": "VirtualHerbalGarden/1.0 (educational project)"
            },
            timeout=10,
        )
        response.raise_for_status()

        results = response.json().get("search", [])

        for item in results:
            if item.get("label", "").casefold() != scientific_name.casefold():
                continue

            entity_id = item.get("id")
            if not entity_id:
                continue

            entity_response = requests.get(
                f"https://www.wikidata.org/wiki/Special:EntityData/{entity_id}.json",
                headers={
                    "User-Agent": "VirtualHerbalGarden/1.0 (educational project)"
                },
                timeout=10,
            )
            entity_response.raise_for_status()

            entity = entity_response.json().get(
                "entities", {}
            ).get(entity_id, {})

            hindi_label = entity.get(
                "labels", {}
            ).get("hi", {}).get("value")

            if hindi_label:
                return hindi_label

    except (requests.RequestException, ValueError):
        return None

    return None

def get_dynamic_plant_about(scientific_name: str):
    try:
        response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "generator": "search",
                "gsrsearch": f'intitle:"{scientific_name}"',
                "gsrlimit": 1,
                "prop": "extracts",
                "exintro": 1,
                "explaintext": 1,
                "exsentences": 3,
                "format": "json",
            },
            headers={
                "User-Agent": "VirtualHerbalGarden/1.0 (educational project)"
            },
            timeout=10,
        )
        response.raise_for_status()

        pages = response.json().get(
            "query", {}
        ).get("pages", {})

        for page in pages.values():
            if (
                page.get("title", "").casefold()
                == scientific_name.casefold()
            ):
                return page.get("extract") or None

    except (requests.RequestException, ValueError):
        return None

    return None


@app.get("/plant-info")
def get_plant_info(scientific_name: str):
    scientific_name = scientific_name.strip()

    hindi_name = HINDI_PLANT_NAMES.get(
        scientific_name.lower()
    )

    if not hindi_name:
        hindi_name = get_dynamic_hindi_name(scientific_name)

    plant_details = PLANT_DETAILS.get(
        scientific_name.lower(),
        {}
    )

    about = plant_details.get("about")

    if not about:
        about = get_dynamic_plant_about(scientific_name)

    if not scientific_name or len(scientific_name) > 150:
        raise HTTPException(
            status_code=400,
            detail="Invalid scientific name.",
        )

    try:
        response = requests.get(
            "https://api.gbif.org/v1/species/match",
            params={
                "name": scientific_name,
                "strict": True,
            },
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

    except (requests.RequestException, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Botanical information service unavailable.",
        )

    if (
        data.get("matchType") == "NONE"
        or data.get("rank") not in ("SPECIES", "SUBSPECIES", "VARIETY")
        or data.get("confidence", 0) < 90
    ):
        return {
            "status": "not_found",
            "scientific_name": scientific_name,
            "hindi_name": hindi_name,
            "family": None,
            "about": about,
            "growing_conditions": plant_details.get("growing_conditions"),
        }

    return {
        "status": "found",
        "scientific_name": scientific_name,
        "hindi_name": hindi_name,
        "family": data.get("family"),
        "about": about,
        "growing_conditions": plant_details.get("growing_conditions"),
        "source": {
            "taxonomy": "GBIF",
            "description": "Wikipedia" if not plant_details.get("about") and about else "Curated project data" if about else None,
}
    }
