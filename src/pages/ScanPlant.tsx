import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { usePlants } from "@/hooks/usePlants";

interface PlantResult {
  status: string;
  message?: string;
  scientific_name?: string | null;
  common_name?: string | null;
  confidence?: number;
  saved?: boolean;
}

interface PlantInfo {
  status: string;
  scientific_name: string;
  hindi_name?: string | null;
  family?: string | null;
  about?: string | null;
  growing_conditions?: string | null;
  source?: {
    taxonomy: string;
    description: string | null;
};
}

const API = import.meta.env.VITE_PLANT_API_URL || "http://localhost:8000";

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

const englishNames: Record<string, string> = {
  "ocimum tenuiflorum": "Holy Basil",
  "ocimum sanctum": "Holy Basil",
  "azadirachta indica": "Neem",
  "aloe vera": "Aloe Vera",
  "withania somnifera": "Ashwagandha",
  "mangifera indica": "Mango",
  "phyllanthus emblica": "Indian Gooseberry",
};

const hindiNames: Record<string, string> = {
  "aloe vera": "घृतकुमारी (ग्वारपाठा)",
  "withania somnifera": "अश्वगंधा",
  "azadirachta indica": "नीम",
  "ocimum tenuiflorum": "तुलसी",
  "ocimum sanctum": "तुलसी",
  "phyllanthus emblica": "आंवला",
  "emblica officinalis": "आंवला",
  "hibiscus rosa-sinensis": "गुड़हल",
};

export default function ScanPlant() {
  const location = useLocation();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
  const selectedPhoto = location.state?.selectedPhoto as File | undefined;

  if (!selectedPhoto) return;

  setFile(selectedPhoto);
  setError("");
  setPlantInfo(null);
  setModelResult(null);
  setExternalResult(null);

  window.history.replaceState(
    { ...window.history.state, usr: null },
    ""
  );
}, [location.state]);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [plantInfo, setPlantInfo] = useState<PlantInfo | null>(null);

  const [modelResult, setModelResult] =
    useState<PlantResult | null>(null);

  const [externalResult, setExternalResult] =
    useState<PlantResult | null>(null);

  const [externalError, setExternalError] =
    useState("");

  const {
    plants,
    loading: plantsLoading,
    error: plantsError,
  } = usePlants();

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function requestIdentification(
    endpoint: string,
    selectedFile: File
  ): Promise<PlantResult> {
    const form = new FormData();
    form.append("image", selectedFile);

    const response = await fetch(`${API}${endpoint}`, {
      method: "POST",
      body: form,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.detail || "Identification failed"
      );
    }

    return data;
  }

  async function identify() {
    if (!file) return;

    setLoading(true);
    setError("");
    setExternalError("");
    setModelResult(null);
    setExternalResult(null);
    setPlantInfo(null);

    const [model, external] = await Promise.allSettled([
      requestIdentification("/identify", file),
      requestIdentification("/identify-external", file),
    ]);

    if (model.status === "fulfilled") {
      setModelResult(model.value);
    } else {
      setError(
        model.reason instanceof Error
          ? model.reason.message
          : "Deep Learning model unavailable"
      );
    }

    if (external.status === "fulfilled") {
  const identified = external.value;
  setExternalResult(identified);

  if (
    identified.status === "identified" &&
    identified.scientific_name
  ) {
    try {
      const response = await fetch(
        `${API}/plant-info?scientific_name=${encodeURIComponent(
          identified.scientific_name
        )}`
      );

      if (response.ok) {
        const info: PlantInfo = await response.json();
        setPlantInfo(info);
      }
    } catch (error) {
      console.error("Plant information fetch failed:", error);
    }
  }
}

    setLoading(false);
  }

  const externalIdentified =
    externalResult?.status === "identified" &&
    Boolean(externalResult.scientific_name);

  const scientificName = externalIdentified
    ? externalResult?.scientific_name || ""
    : "";

  const englishName = externalIdentified
    ? englishNames[scientificName.toLowerCase()] ||
      externalResult?.common_name ||
      scientificName
      : "";

  const matchedPlant =
    externalIdentified && !plantsError
      ? plants.find((plant) => {
          const scientific = normalizeName(
            plant.scientificName || ""
          );

          const common = normalizeName(
            plant.name || ""
          );

          return (
            scientific === normalizeName(scientificName) ||
            common === normalizeName(englishName)
          );
        })
      : undefined;

  const hindiName = externalIdentified
    ? matchedPlant?.hindiName ||
      hindiNames[scientificName.toLowerCase()] ||
      "Hindi name not available"
    : "";

  const modelAgrees =
    modelResult?.status === "predicted" &&
    externalIdentified &&
    (
      normalizeName(modelResult.common_name || "") ===
        normalizeName(englishName) ||
      normalizeName(modelResult.common_name || "") ===
        normalizeName(scientificName) ||
      (
        normalizeName(modelResult.common_name || "") ===
          "tulsi" &&
        ["ocimumtenuiflorum", "ocimumsanctum"].includes(
          normalizeName(scientificName)
        )
      ) ||
      (
        normalizeName(modelResult.common_name || "") ===
          "neem" &&
        normalizeName(scientificName) ===
          "azadirachtaindica"
      )
    );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f1f8f0",
        padding: "3rem 1rem",
        color: "#173b29",
      }}
    >
      <div
        style={{
          maxWidth: 650,
          margin: "auto",
          background: "white",
          padding: 28,
          borderRadius: 18,
          boxShadow: "0 8px 25px #173b2915",
        }}
      >
        <Link to="/garden">
          ← Back to garden
        </Link>

        <h1
          style={{
            fontSize: 30,
            fontWeight: 700,
            marginTop: 20,
          }}
        >
          🌿 Scan a Plant
        </h1>

        <p>
          Upload a plant image to identify its species.
          Our Deep Learning model and plant identification
          service will analyze the photo.
        </p>

        <label
          style={{
            display: "block",
            marginTop: 22,
            fontWeight: 600,
          }}
        >
          Plant image
        </label>

        <label
  style={{
    display: "block",
    marginTop: 22,
    fontWeight: 600,
  }}
>
  Plant image
</label>

{/* NEW CAMERA AND GALLERY SECTION */}
<div className="flex flex-col sm:flex-row gap-3 mt-4">

  {/* Camera input */}
  <input
    ref={cameraInputRef}
    type="file"
    accept="image/*"
    capture="environment"
    className="hidden"
    onChange={(e) => {
      setFile(e.target.files?.[0] || null);
      setModelResult(null);
      setExternalResult(null);
      setPlantInfo(null);
      setError("");
      setExternalError("");
      e.target.value = "";
    }}
  />

  {/* Gallery input */}
  <input
    ref={galleryInputRef}
    type="file"
    accept="image/*"
    className="hidden"
    onChange={(e) => {
      setFile(e.target.files?.[0] || null);
      setModelResult(null);
      setExternalResult(null);
      setPlantInfo(null);
      setError("");
      setExternalError("");
      e.target.value = "";
    }}
  />

  <button
    type="button"
    onClick={() => cameraInputRef.current?.click()}
    className="bg-green-700 text-white px-5 py-3 rounded-xl font-semibold"
  >
    📷 Take Photo
  </button>

  <button
    type="button"
    onClick={() => galleryInputRef.current?.click()}
    className="bg-gray-100 text-green-800 px-5 py-3 rounded-xl font-semibold border border-green-300"
  >
    🖼️ Choose from Gallery
  </button>

</div>

{/* EXISTING IMAGE PREVIEW - KEEP THIS */}
{preview && (
  <img
    src={preview}
    alt="Selected plant"
    style={{
      width: "100%",
      maxHeight: 360,
      objectFit: "contain",
      borderRadius: 12,
    }}
  />
)}

        {preview && (
          <img
            src={preview}
            alt="Selected plant"
            style={{
              width: "100%",
              maxHeight: 360,
              objectFit: "contain",
              borderRadius: 12,
            }}
          />
        )}

        <button
          disabled={!file || loading}
          onClick={identify}
          style={{
            background: "#267849",
            color: "white",
            padding: "12px 22px",
            borderRadius: 10,
            marginTop: 16,
            opacity: !file || loading ? 0.5 : 1,
          }}
        >
          {loading
            ? "Analyzing..."
            : "Identify Plant"}
        </button>

        {error && (
          <p
            role="alert"
            style={{
              color: "#a12525",
              marginTop: 16,
            }}
          >
            Model: {error}
          </p>
        )}

        {externalError && (
          <p
            role="alert"
            style={{
              color: "#a12525",
              marginTop: 12,
            }}
          >
            Plant API: {externalError}
          </p>
        )}

        {/* {modelResult && (
          <section
            style={{
              marginTop: 22,
              padding: 18,
              background: "#f5f7fa",
              borderRadius: 12,
            }}
          >
            <h2 style={{ fontWeight: 700, fontSize: 19 }}>
              🧠 Custom Deep Learning Model
            </h2>

            <p>
              Prediction:{" "}
              <strong>
                {modelResult.common_name ||
                  "Unknown"}
              </strong>
            </p> */}

            {/* {typeof modelResult.confidence ===
              "number" && (
              <p>
                Model score:{" "}
                {(
                  modelResult.confidence * 100
                ).toFixed(1)}
                %
              </p>
            )} */}

            {/* <p style={{ fontSize: 13 }}>
              Trained on Aloe Vera, Neem and Tulsi.
              This model cannot independently verify
              unknown species.
            </p>

            {externalIdentified && (
              <p style={{ fontWeight: 600 }}>
                {modelAgrees
                  ? "✓ Model and external identification agree."
                  : "Model prediction is not confirmed by external identification."}
              </p>
            )}
          </section>
        )} */}

        {externalResult && (
          <section
            style={{
              marginTop: 22,
              padding: 18,
              background: "#eef7ef",
              borderRadius: 12,
            }}
          >
            <h2
              style={{
                fontWeight: 700,
                fontSize: 21,
              }}
            >
              🌱 Plant Identification
            </h2>

            {externalIdentified ? (
              <>
                <p>
                  <b>English Name:</b>{" "}
                  {englishName}
                </p>

                <p>
                  <b>Hindi Name:</b>{" "}
                  {plantInfo?.hindi_name || hindiName}
                </p>

                <p>
                  <b>Scientific Name:</b>{" "}
                  <i>{scientificName}</i>
                </p>

{/* Plant Family */}
{plantInfo?.family && (
  <p>
    <b>Family:</b> {plantInfo.family}
  </p>
)}

{/* About the Plant */}
{plantInfo?.about && (
  <div className="mt-4">
    <h3 className="font-semibold">About the Plant</h3>
    <p>{plantInfo.about}</p>
  </div>
)}

{/* Growing Conditions */}
{plantInfo && (
  <div className="mt-4">
    <h3 className="font-semibold">Growing Conditions</h3>
    <p>
      {plantInfo.growing_conditions ||
        "Growing information is not available for this plant yet."}
    </p>
  </div>
)}

                {/* {typeof externalResult.confidence ===
                  "number" && (
                  <p>
                    Identification score:{" "}
                    {(
                      externalResult.confidence *
                      100
                    ).toFixed(1)}
                    %
                  </p>
                )} */}

                {/* <p>{externalResult.message}</p> */}

                {plantsLoading && (
                  <p>
                    Checking plant database...
                  </p>
                )}

                {plantsError && (
                  <p>
                    Could not check plant database.
                  </p>
                )}

                {matchedPlant && (
                  <Link
                    to={`/plant/${matchedPlant.id}`}
                    className="inline-block mt-4 px-6 py-3 bg-green-700 text-white font-semibold rounded-xl hover:bg-green-800 transition-colors"
                  >
                    🌿 Explore Plant →
                  </Link>
                )}

                {!plantsLoading &&
                  !plantsError &&
                  !matchedPlant && (
                    <p
                      style={{
                        marginTop: 12,
                        fontSize: 14,
                      }}
                    >
                      This plant is not currently
                      available in our garden database.
                    </p>
                  )}
              </>
            ) : (
              <p>
                {externalResult.message ||
                  "Plant could not be identified."}
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
