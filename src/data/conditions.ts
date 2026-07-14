/**
 * Curated condition catalog — the "conditions the engine understands".
 *
 * This is a STARTING POINT, not the ceiling: it carries the value-add metadata the
 * pattern/screening logic reasons on (category, inheritance pattern, rough prevalence,
 * synonyms) plus baked-in codes for the high-signal subset. The long tail of ICD-10-CM
 * (~74,000 codes) is reached at runtime through the vocabulary adapter
 * (`src/integrations/vocabulary.ts`), so the app is never limited to this list.
 *
 * DO NOT EDIT BY HAND — regenerate with `npm run gen:conditions`, which re-derives it
 * from `scripts/conditions.source.json` and the verified code maps. See `docs/ARCHITECTURE.md`.
 *
 * Prevalences are illustrative (roadmap §3 tracks binding them to sourced epidemiology).
 * ICD-10-CM codes verified against FY2026; SNOMED CT concept ids are representative.
 * 115 conditions, 23 with ICD-10-CM codes.
 */
import type { CategoryKey, Condition } from '@/domain/types';

export const CONDITIONS: readonly Condition[] = [
  { id: "cad", name: "Coronary heart disease", cat: "card", base: 9, pattern: "Multifactorial / polygenic", syn: ["heart attack","cad","ischemic heart disease","coronary artery disease","mi"], icd10: "I25.10", snomed: "53741008" },
  { id: "htn", name: "Hypertension", cat: "card", base: 50, pattern: "Multifactorial", syn: ["high blood pressure","bp"], icd10: "I10", snomed: "38341003" },
  { id: "chol", name: "High cholesterol", cat: "card", base: 40, pattern: "Multifactorial / possible FH", syn: ["hyperlipidemia","dyslipidemia","ldl"], icd10: "E78.5", snomed: "13644009" },
  { id: "stroke", name: "Stroke", cat: "card", base: 6, pattern: "Multifactorial", syn: ["cva","cerebrovascular accident","brain attack"], icd10: "I63.9", snomed: "230690007" },
  { id: "afib", name: "Atrial fibrillation", cat: "card", base: 25, pattern: "Multifactorial", syn: ["irregular heartbeat","af","arrhythmia"], icd10: "I48.91", snomed: "49436004" },
  { id: "hf", name: "Heart failure", cat: "card", base: 20, pattern: "Multifactorial", syn: ["congestive heart failure","chf"] },
  { id: "aaa", name: "Abdominal aortic aneurysm", cat: "card", base: 4, pattern: "Polygenic", syn: ["aneurysm","aaa"] },
  { id: "vte", name: "Venous thromboembolism", cat: "card", base: 5, pattern: "Thrombophilia / multifactorial", syn: ["blood clot","dvt","pulmonary embolism","pe"] },
  { id: "cardiomyo", name: "Cardiomyopathy", cat: "card", base: 1, pattern: "Autosomal dominant", syn: ["hcm","dilated cardiomyopathy","enlarged heart"] },
  { id: "longqt", name: "Long QT syndrome", cat: "card", base: 0.3, pattern: "Autosomal dominant", syn: ["lqts","arrhythmia"] },
  { id: "pad", name: "Peripheral artery disease", cat: "card", base: 5, pattern: "Multifactorial", syn: ["pad","claudication"] },
  { id: "mvp", name: "Mitral valve prolapse", cat: "card", base: 2, pattern: "Variable", syn: ["mvp","heart murmur"] },
  { id: "brca", name: "Breast cancer", cat: "canc", base: 13, pattern: "Autosomal dominant (possible BRCA)", syn: ["breast carcinoma","brca"], icd10: "C50.919", snomed: "254837009" },
  { id: "colon", name: "Colorectal cancer", cat: "canc", base: 4.5, pattern: "Multifactorial / possible Lynch", syn: ["colon cancer","bowel cancer","rectal cancer"], icd10: "C18.9", snomed: "363406005" },
  { id: "prostate", name: "Prostate cancer", cat: "canc", base: 12, pattern: "Multifactorial", syn: ["prostate carcinoma"], icd10: "C61", snomed: "399068003" },
  { id: "lung", name: "Lung cancer", cat: "canc", base: 6, pattern: "Multifactorial / environmental", syn: ["lung carcinoma"], icd10: "C34.90", snomed: "93880001" },
  { id: "ovarian", name: "Ovarian cancer", cat: "canc", base: 1.3, pattern: "Autosomal dominant (BRCA)", syn: ["ovary cancer"], icd10: "C56.9", snomed: "363443007" },
  { id: "panc", name: "Pancreatic cancer", cat: "canc", base: 1.6, pattern: "Multifactorial", syn: ["pancreas cancer"], icd10: "C25.9", snomed: "372003004" },
  { id: "melanoma", name: "Melanoma", cat: "canc", base: 2.3, pattern: "Multifactorial / CDKN2A", syn: ["skin cancer"], icd10: "C43.9", snomed: "2092003" },
  { id: "gastric", name: "Gastric cancer", cat: "canc", base: 1, pattern: "Multifactorial / CDH1", syn: ["stomach cancer"], icd10: "C16.9", snomed: "363349007" },
  { id: "endometrial", name: "Endometrial cancer", cat: "canc", base: 3, pattern: "Possible Lynch", syn: ["uterine cancer","womb cancer"], icd10: "C54.9", snomed: "315267003" },
  { id: "thyroidca", name: "Thyroid cancer", cat: "canc", base: 1.2, pattern: "Multifactorial / RET", syn: ["thyroid carcinoma"] },
  { id: "kidneyca", name: "Kidney cancer", cat: "canc", base: 2, pattern: "Multifactorial / VHL", syn: ["renal cell carcinoma","rcc"] },
  { id: "bladderca", name: "Bladder cancer", cat: "canc", base: 2.4, pattern: "Multifactorial" },
  { id: "leukemia", name: "Leukemia", cat: "canc", base: 1.5, pattern: "Multifactorial", syn: ["blood cancer","aml","cll"] },
  { id: "lymphoma", name: "Non-Hodgkin lymphoma", cat: "canc", base: 2.1, pattern: "Multifactorial", syn: ["lymphoma"] },
  { id: "cervical", name: "Cervical cancer", cat: "canc", base: 0.6, pattern: "HPV / environmental" },
  { id: "liverca", name: "Liver cancer", cat: "canc", base: 1, pattern: "Multifactorial", syn: ["hepatocellular carcinoma","hcc"] },
  { id: "brainca", name: "Brain / CNS tumor", cat: "canc", base: 0.6, pattern: "Multifactorial", syn: ["glioma","brain tumor"] },
  { id: "testicular", name: "Testicular cancer", cat: "canc", base: 0.4, pattern: "Multifactorial" },
  { id: "t2d", name: "Type 2 diabetes", cat: "endo", base: 11, pattern: "Multifactorial", syn: ["diabetes","sugar","t2dm","adult onset diabetes"], icd10: "E11.9", snomed: "44054006" },
  { id: "t1d", name: "Type 1 diabetes", cat: "endo", base: 0.5, pattern: "Autoimmune / polygenic", syn: ["juvenile diabetes","t1dm","insulin dependent"], icd10: "E10.9", snomed: "46635009" },
  { id: "thy", name: "Hypothyroidism", cat: "endo", base: 12, pattern: "Autoimmune / polygenic", syn: ["underactive thyroid","hashimoto","low thyroid"], icd10: "E03.9", snomed: "40930008" },
  { id: "hyperthy", name: "Hyperthyroidism", cat: "endo", base: 1.2, pattern: "Autoimmune", syn: ["graves disease","overactive thyroid"] },
  { id: "obesity", name: "Obesity", cat: "endo", base: 40, pattern: "Multifactorial", syn: ["overweight","high bmi"] },
  { id: "gout", name: "Gout", cat: "endo", base: 4, pattern: "Multifactorial", syn: ["uric acid","hyperuricemia"] },
  { id: "pcos", name: "PCOS", cat: "endo", base: 8, pattern: "Multifactorial", syn: ["polycystic ovary syndrome"] },
  { id: "osteoporosis", name: "Osteoporosis", cat: "endo", base: 20, pattern: "Multifactorial", syn: ["brittle bones","low bone density"] },
  { id: "mody", name: "MODY diabetes", cat: "endo", base: 0.2, pattern: "Autosomal dominant", syn: ["maturity onset diabetes"] },
  { id: "metabolic", name: "Metabolic syndrome", cat: "endo", base: 33, pattern: "Multifactorial", syn: ["insulin resistance","syndrome x"] },
  { id: "addison", name: "Addison's disease", cat: "endo", base: 0.02, pattern: "Autoimmune", syn: ["adrenal insufficiency"] },
  { id: "hemochrom", name: "Hemochromatosis", cat: "endo", base: 0.5, pattern: "Autosomal recessive", syn: ["iron overload"] },
  { id: "alz", name: "Alzheimer's disease", cat: "neuro", base: 11, pattern: "Late-onset multifactorial (APOE)", syn: ["dementia","memory loss"], icd10: "G30.9", snomed: "26929004" },
  { id: "park", name: "Parkinson's disease", cat: "neuro", base: 2, pattern: "Multifactorial", syn: ["parkinsons","tremor"] },
  { id: "epilepsy", name: "Epilepsy", cat: "neuro", base: 3, pattern: "Multifactorial", syn: ["seizure disorder","seizures"] },
  { id: "migraine", name: "Migraine", cat: "neuro", base: 15, pattern: "Multifactorial", syn: ["headache","migraines"] },
  { id: "ms", name: "Multiple sclerosis", cat: "neuro", base: 0.3, pattern: "Autoimmune / polygenic", syn: ["ms"] },
  { id: "als", name: "ALS", cat: "neuro", base: 0.3, pattern: "Multifactorial / SOD1", syn: ["lou gehrig","motor neuron disease"] },
  { id: "hunt", name: "Huntington's disease", cat: "neuro", base: 0.01, pattern: "Autosomal dominant", syn: ["huntingtons","chorea"] },
  { id: "vascdem", name: "Vascular dementia", cat: "neuro", base: 5, pattern: "Multifactorial", syn: ["dementia"] },
  { id: "neuropathy", name: "Peripheral neuropathy", cat: "neuro", base: 8, pattern: "Multifactorial", syn: ["nerve damage","numbness"] },
  { id: "tremor", name: "Essential tremor", cat: "neuro", base: 4, pattern: "Autosomal dominant", syn: ["shaking","tremor"] },
  { id: "rls", name: "Restless legs syndrome", cat: "neuro", base: 7, pattern: "Multifactorial", syn: ["rls"] },
  { id: "narco", name: "Narcolepsy", cat: "neuro", base: 0.05, pattern: "HLA-associated", syn: ["sleep attacks"] },
  { id: "dep", name: "Depression", cat: "ment", base: 20, pattern: "Multifactorial", syn: ["major depressive disorder","mdd","low mood"], icd10: "F32.9", snomed: "35489007" },
  { id: "anx", name: "Anxiety disorder", cat: "ment", base: 19, pattern: "Multifactorial", syn: ["gad","panic","anxiety"], icd10: "F41.9", snomed: "48694002" },
  { id: "bipolar", name: "Bipolar disorder", cat: "ment", base: 2.8, pattern: "Multifactorial / high heritability", syn: ["manic depression","bipolar"] },
  { id: "schizo", name: "Schizophrenia", cat: "ment", base: 1, pattern: "Multifactorial / high heritability", syn: ["psychosis"] },
  { id: "ocd", name: "OCD", cat: "ment", base: 2.3, pattern: "Multifactorial", syn: ["obsessive compulsive disorder"] },
  { id: "ptsd", name: "PTSD", cat: "ment", base: 7, pattern: "Multifactorial / environmental", syn: ["post traumatic stress"] },
  { id: "adhd", name: "ADHD", cat: "ment", base: 8, pattern: "Multifactorial / high heritability", syn: ["attention deficit","add"] },
  { id: "autism", name: "Autism spectrum", cat: "ment", base: 2.8, pattern: "Multifactorial / high heritability", syn: ["asd","autistic"] },
  { id: "eating", name: "Eating disorder", cat: "ment", base: 2, pattern: "Multifactorial", syn: ["anorexia","bulimia"] },
  { id: "sud", name: "Substance use disorder", cat: "ment", base: 10, pattern: "Multifactorial", syn: ["addiction","alcoholism","alcohol use disorder"] },
  { id: "ra", name: "Rheumatoid arthritis", cat: "auto", base: 1, pattern: "Autoimmune / HLA", syn: ["ra","inflammatory arthritis"] },
  { id: "lupus", name: "Lupus (SLE)", cat: "auto", base: 0.1, pattern: "Autoimmune", syn: ["systemic lupus","sle"] },
  { id: "celiac", name: "Celiac disease", cat: "auto", base: 1, pattern: "Autoimmune (HLA-DQ2/DQ8)", syn: ["gluten intolerance","sprue"], icd10: "K90.0", snomed: "396331005" },
  { id: "psoriasis", name: "Psoriasis", cat: "auto", base: 3, pattern: "Autoimmune / polygenic", syn: ["psoriatic"] },
  { id: "crohn", name: "Crohn's disease", cat: "auto", base: 0.3, pattern: "Autoimmune / polygenic", syn: ["ibd","crohns"] },
  { id: "uc", name: "Ulcerative colitis", cat: "auto", base: 0.4, pattern: "Autoimmune / polygenic", syn: ["ibd","colitis"] },
  { id: "sjogren", name: "Sjögren's syndrome", cat: "auto", base: 0.5, pattern: "Autoimmune", syn: ["dry eyes","sjogrens"] },
  { id: "scleroderma", name: "Scleroderma", cat: "auto", base: 0.05, pattern: "Autoimmune", syn: ["systemic sclerosis"] },
  { id: "vitiligo", name: "Vitiligo", cat: "auto", base: 1, pattern: "Autoimmune", syn: ["skin depigmentation"] },
  { id: "as", name: "Ankylosing spondylitis", cat: "auto", base: 0.3, pattern: "HLA-B27", syn: ["spine arthritis"] },
  { id: "asthma", name: "Asthma", cat: "resp", base: 8, pattern: "Multifactorial / atopy", syn: ["wheezing","reactive airway"], icd10: "J45.909", snomed: "195967001" },
  { id: "copd", name: "COPD", cat: "resp", base: 6, pattern: "Multifactorial / environmental", syn: ["emphysema","chronic bronchitis"] },
  { id: "cf", name: "Cystic fibrosis", cat: "resp", base: 0.04, pattern: "Autosomal recessive", syn: ["cf"] },
  { id: "osa", name: "Obstructive sleep apnea", cat: "resp", base: 12, pattern: "Multifactorial", syn: ["sleep apnea","snoring"] },
  { id: "pulmfib", name: "Pulmonary fibrosis", cat: "resp", base: 0.2, pattern: "Multifactorial", syn: ["ipf","scarred lungs"] },
  { id: "a1at", name: "Alpha-1 antitrypsin deficiency", cat: "resp", base: 0.1, pattern: "Autosomal recessive", syn: ["a1at"] },
  { id: "gerd", name: "GERD", cat: "gi", base: 20, pattern: "Multifactorial", syn: ["acid reflux","heartburn"] },
  { id: "ibs", name: "Irritable bowel syndrome", cat: "gi", base: 11, pattern: "Multifactorial", syn: ["ibs"] },
  { id: "gallstones", name: "Gallstones", cat: "gi", base: 10, pattern: "Multifactorial", syn: ["cholelithiasis"] },
  { id: "fattyliver", name: "Fatty liver disease", cat: "gi", base: 25, pattern: "Multifactorial", syn: ["nafld","nash"] },
  { id: "pud", name: "Peptic ulcer disease", cat: "gi", base: 8, pattern: "Multifactorial / H. pylori", syn: ["stomach ulcer","ulcer"] },
  { id: "diverticulosis", name: "Diverticulosis", cat: "gi", base: 35, pattern: "Multifactorial", syn: ["diverticulitis"] },
  { id: "pancreatitis", name: "Chronic pancreatitis", cat: "gi", base: 0.5, pattern: "Multifactorial" },
  { id: "lactose", name: "Lactose intolerance", cat: "gi", base: 20, pattern: "Genetic", syn: ["dairy intolerance"] },
  { id: "ckd", name: "Chronic kidney disease", cat: "renal", base: 14, pattern: "Multifactorial", syn: ["ckd","kidney failure"] },
  { id: "pkd", name: "Polycystic kidney disease", cat: "renal", base: 0.2, pattern: "Autosomal dominant", syn: ["pkd"] },
  { id: "kidneystones", name: "Kidney stones", cat: "renal", base: 9, pattern: "Multifactorial", syn: ["renal calculi","nephrolithiasis"] },
  { id: "bph", name: "Enlarged prostate (BPH)", cat: "renal", base: 25, pattern: "Age-related", syn: ["bph","prostate enlargement"] },
  { id: "oa", name: "Osteoarthritis", cat: "musc", base: 25, pattern: "Multifactorial", syn: ["arthritis","joint degeneration"], icd10: "M19.90", snomed: "396275006" },
  { id: "backpain", name: "Chronic low back pain", cat: "musc", base: 13, pattern: "Multifactorial", syn: ["back pain"] },
  { id: "fibro", name: "Fibromyalgia", cat: "musc", base: 2, pattern: "Multifactorial", syn: ["chronic pain"] },
  { id: "md", name: "Muscular dystrophy", cat: "musc", base: 0.02, pattern: "X-linked / recessive", syn: ["dmd","muscle wasting"] },
  { id: "ehlers", name: "Ehlers-Danlos syndrome", cat: "musc", base: 0.02, pattern: "Variable inheritance", syn: ["eds","hypermobility"] },
  { id: "scoliosis", name: "Scoliosis", cat: "musc", base: 3, pattern: "Multifactorial", syn: ["curved spine"] },
  { id: "anemia", name: "Iron-deficiency anemia", cat: "blood", base: 5, pattern: "Multifactorial", syn: ["low iron","anaemia"] },
  { id: "sickle", name: "Sickle cell disease", cat: "blood", base: 0.1, pattern: "Autosomal recessive", syn: ["sickle cell anemia"] },
  { id: "thalassemia", name: "Thalassemia", cat: "blood", base: 0.1, pattern: "Autosomal recessive" },
  { id: "hemophilia", name: "Hemophilia", cat: "blood", base: 0.01, pattern: "X-linked recessive", syn: ["bleeding disorder"] },
  { id: "g6pd", name: "G6PD deficiency", cat: "blood", base: 0.5, pattern: "X-linked", syn: ["g6pd"] },
  { id: "factorv", name: "Factor V Leiden", cat: "blood", base: 5, pattern: "Autosomal dominant / thrombophilia", syn: ["clotting disorder","thrombophilia"] },
  { id: "vwd", name: "Von Willebrand disease", cat: "blood", base: 1, pattern: "Autosomal dominant", syn: ["bleeding disorder","vwd"] },
  { id: "glaucoma", name: "Glaucoma", cat: "sens", base: 3, pattern: "Multifactorial", syn: ["eye pressure"] },
  { id: "amd", name: "Macular degeneration", cat: "sens", base: 2, pattern: "Multifactorial / CFH", syn: ["amd","vision loss"] },
  { id: "cataracts", name: "Cataracts", cat: "sens", base: 20, pattern: "Age-related / multifactorial", syn: ["cloudy lens"] },
  { id: "hearingloss", name: "Age-related hearing loss", cat: "sens", base: 20, pattern: "Multifactorial", syn: ["presbycusis","deafness"] },
  { id: "colorblind", name: "Color blindness", cat: "sens", base: 4, pattern: "X-linked recessive", syn: ["color vision deficiency"] },
  { id: "retinitis", name: "Retinitis pigmentosa", cat: "sens", base: 0.03, pattern: "Variable inheritance", syn: ["rp","night blindness"] },
  { id: "eczema", name: "Eczema (atopic dermatitis)", cat: "sens", base: 10, pattern: "Multifactorial / atopy", syn: ["dermatitis","atopic"] },
  { id: "endometriosis", name: "Endometriosis", cat: "repro", base: 10, pattern: "Multifactorial", syn: ["endo"] },
  { id: "infertility", name: "Infertility", cat: "repro", base: 8, pattern: "Multifactorial", syn: ["subfertility"] },
  { id: "preeclampsia", name: "Preeclampsia (history)", cat: "repro", base: 5, pattern: "Multifactorial", syn: ["pregnancy hypertension","toxemia"] },
];

/** Ids shown, in order, when the condition search box is empty. */
export const COMMON_CONDITIONS: readonly string[] = ["htn","t2d","chol","cad","dep","anx","asthma","thy","oa","brca","colon","alz"];

/** Assert the catalog only uses known category keys at module load. */
const CATEGORY_KEYS: ReadonlySet<CategoryKey> = new Set([
  'card', 'canc', 'endo', 'neuro', 'ment', 'auto', 'resp', 'gi', 'renal', 'musc', 'blood', 'sens', 'repro', 'other',
]);
for (const c of CONDITIONS) {
  if (!CATEGORY_KEYS.has(c.cat)) throw new Error(`Unknown category ${c.cat} on ${c.id}`);
}

