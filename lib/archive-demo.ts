import type {
  BloodMarker,
  BloodPanelRecord,
  ReferenceRange,
  WearableSeriesRecord,
} from "./archive"

export const DEMO_SHARED_MARKER_IDS = [
  "marker:ferritin",
  "marker:fasting-glucose",
  "marker:hba1c",
  "marker:tsh",
  "marker:vitamin-d",
]

export const DEMO_BLOOD_PANEL: BloodPanelRecord = {
  id: "record:blood-panel:2026-08-12",
  kind: "blood-panel",
  takenOn: "2026-08-12",
  provenance: {
    sourceId: "source:panel:2026-08-12",
    importedAt: "2026-08-12T10:00:00.000Z",
  },
  markers: [
    marker({ id: "haemoglobin", name: "Haemoglobin", value: 13.8, unit: "g/dL", referenceRange: { min: 12, max: 16 } }),
    marker({ id: "haematocrit", name: "Haematocrit", value: 41.2, unit: "%", referenceRange: { min: 36, max: 46 } }),
    marker({ id: "red-blood-cells", name: "Red blood cells", value: 4.65, unit: "10^12/L", referenceRange: { min: 4.1, max: 5.1 } }),
    marker({ id: "white-blood-cells", name: "White blood cells", value: 6.4, unit: "10^9/L", referenceRange: { min: 4, max: 11 } }),
    marker({ id: "platelets", name: "Platelets", value: 248, unit: "10^9/L", referenceRange: { min: 150, max: 400 } }),
    marker({ id: "mcv", name: "Mean corpuscular volume", value: 88.6, unit: "fL", referenceRange: { min: 80, max: 100 } }),
    marker({ id: "mch", name: "Mean corpuscular haemoglobin", value: 29.7, unit: "pg", referenceRange: { min: 27, max: 33 } }),
    marker({ id: "mchc", name: "Mean corpuscular haemoglobin concentration", value: 33.5, unit: "g/dL", referenceRange: { min: 32, max: 36 } }),
    marker({ id: "rdw", name: "Red cell distribution width", value: 12.9, unit: "%", referenceRange: { min: 11.5, max: 14.5 } }),
    marker({ id: "neutrophils", name: "Neutrophils", value: 3.7, unit: "10^9/L", referenceRange: { min: 2, max: 7.5 } }),
    marker({ id: "lymphocytes", name: "Lymphocytes", value: 2, unit: "10^9/L", referenceRange: { min: 1, max: 4 } }),
    marker({ id: "monocytes", name: "Monocytes", value: 0.45, unit: "10^9/L", referenceRange: { min: 0.2, max: 0.8 } }),
    marker({ id: "eosinophils", name: "Eosinophils", value: 0.18, unit: "10^9/L", referenceRange: { min: 0, max: 0.5 } }),
    marker({ id: "basophils", name: "Basophils", value: 0.05, unit: "10^9/L", referenceRange: { min: 0, max: 0.1 } }),
    marker({ id: "ferritin", name: "Ferritin", value: 38, unit: "µg/L", referenceRange: { min: 15, max: 300 } }),
    marker({ id: "iron", name: "Iron", value: 92, unit: "µg/dL", referenceRange: { min: 50, max: 170 } }),
    marker({ id: "transferrin", name: "Transferrin", value: 252, unit: "mg/dL", referenceRange: { min: 200, max: 360 } }),
    marker({ id: "transferrin-saturation", name: "Transferrin saturation", value: 29, unit: "%", referenceRange: { min: 20, max: 50 } }),
    marker({ id: "fasting-glucose", name: "Fasting glucose", value: 89, unit: "mg/dL", referenceRange: { min: 70, max: 99 } }),
    marker({ id: "hba1c", name: "HbA1c", value: 5.2, unit: "%", referenceRange: { min: 4, max: 5.6 } }),
    marker({ id: "total-cholesterol", name: "Total cholesterol", value: 184, unit: "mg/dL", referenceRange: { max: 200 } }),
    marker({ id: "ldl-cholesterol", name: "LDL cholesterol", value: 142, unit: "mg/dL", referenceRange: { max: 129 } }),
    marker({ id: "hdl-cholesterol", name: "HDL cholesterol", value: 62, unit: "mg/dL", referenceRange: { min: 50 } }),
    marker({ id: "triglycerides", name: "Triglycerides", value: 86, unit: "mg/dL", referenceRange: { max: 150 } }),
    marker({ id: "alt", name: "Alanine aminotransferase", value: 48, unit: "U/L", referenceRange: { min: 7, max: 40 } }),
    marker({ id: "ast", name: "Aspartate aminotransferase", value: 26, unit: "U/L", referenceRange: { min: 10, max: 40 } }),
    marker({ id: "ggt", name: "Gamma-glutamyl transferase", value: 21, unit: "U/L", referenceRange: { min: 9, max: 36 } }),
    marker({ id: "creatinine", name: "Creatinine", value: 0.78, unit: "mg/dL", referenceRange: { min: 0.55, max: 1.02 } }),
    marker({ id: "egfr", name: "Estimated glomerular filtration rate", value: 104, unit: "mL/min/1.73m²", referenceRange: { min: 60 } }),
    marker({ id: "tsh", name: "Thyroid-stimulating hormone", value: 2.1, unit: "mIU/L", referenceRange: { min: 0.4, max: 4 } }),
    marker({ id: "vitamin-d", name: "Vitamin D", value: 18, unit: "ng/mL", referenceRange: { min: 30, max: 100 }, labFlag: "LOW" }),
    marker({ id: "crp", name: "C-reactive protein", value: 0.7, unit: "mg/L", referenceRange: { max: 3 } }),
  ],
}

export const DEMO_SLEEP_SERIES: WearableSeriesRecord = {
  id: "record:wearable:sleep-duration:2026-08-07:2026-09-03",
  kind: "wearable-series",
  metric: "sleep-duration",
  unit: "minutes",
  range: { from: "2026-08-07", through: "2026-09-03" },
  target: 450,
  provenance: {
    sourceId: "source:wearable:sleep:2026-09-04",
    importedAt: "2026-09-04T08:00:00.000Z",
  },
  values: [
    { date: "2026-08-07", value: 414 },
    { date: "2026-08-08", value: 324 },
    { date: "2026-08-09", value: 396 },
    { date: "2026-08-10", value: 348 },
    { date: "2026-08-11", value: 426 },
    { date: "2026-08-12", value: 360 },
    { date: "2026-08-13", value: 312 },
    { date: "2026-08-14", value: 408 },
    { date: "2026-08-15", value: 378 },
    { date: "2026-08-16", value: 336 },
    { date: "2026-08-17", value: 432 },
    { date: "2026-08-18", value: 354 },
    { date: "2026-08-19", value: 390 },
    { date: "2026-08-20", value: 330 },
    { date: "2026-08-21", value: 462 },
    { date: "2026-08-22", value: 294 },
    { date: "2026-08-23", value: 456 },
    { date: "2026-08-24", value: 306 },
    { date: "2026-08-25", value: 384 },
    { date: "2026-08-26", value: 318 },
    { date: "2026-08-27", value: 468 },
    { date: "2026-08-28", value: 282 },
    { date: "2026-08-29", value: 366 },
    { date: "2026-08-30", value: 348 },
    { date: "2026-08-31", value: 456 },
    { date: "2026-09-01", value: 300 },
    { date: "2026-09-02", value: 372 },
    { date: "2026-09-03", value: 396 },
  ],
}

function marker(params: {
  id: string
  name: string
  value: number
  unit: string
  referenceRange: ReferenceRange
  /** The lab's own out-of-range call — carried through as data, never a reason to flag the demo panel. */
  labFlag?: string
}): BloodMarker {
  const { labFlag, ...rest } = params
  return {
    ...rest,
    id: `marker:${params.id}`,
    flaggedAtImport: false,
    ...(labFlag ? { labFlag } : {}),
  }
}
