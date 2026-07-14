/**
 * Curated condition catalog — the "conditions the engine understands".
 *
 * This is a STARTING POINT, not the ceiling: it carries the value-add metadata the
 * pattern/screening logic reasons on (category, inheritance pattern, prevalence,
 * synonyms) plus baked-in codes for the high-signal subset. The long tail of ICD-10-CM
 * (~74,000 codes) is reached at runtime through the vocabulary adapter
 * (`src/integrations/vocabulary.ts`), so the app is never limited to this list.
 *
 * DO NOT EDIT BY HAND — regenerate with `npm run gen:conditions`, which re-derives it
 * from `scripts/conditions.source.json` and the verified code + epidemiology maps. See
 * `docs/ARCHITECTURE.md`.
 *
 * Prevalence is bound to sourced epidemiology (CDC / SEER / NHANES / AHA, etc.) where a
 * `prevSource` is present (roadmap §3); the rest remain illustrative starting values.
 * Heritability (`herit`) is a cited population statistic, never a personal-risk number.
 * ICD-10-CM codes verified against FY2026; SNOMED CT and HPO ids are representative.
 * 116 conditions — 72 ICD-10-CM, 72 SNOMED CT, 32 HPO, 44 sourced-prevalence.
 */
import type { CategoryKey, Condition } from '@/domain/types';

export const CONDITIONS: readonly Condition[] = [
  { id: "cad", name: "Coronary heart disease", cat: "card", base: 6, prevSource: "AHA Statistics 2024 (~5% adults)", herit: 0.4, heritSource: "twin studies (est.)", pattern: "Multifactorial / polygenic", syn: ["heart attack","cad","ischemic heart disease","coronary artery disease","mi"], icd10: "I25.10", snomed: "53741008" },
  { id: "htn", name: "Hypertension", cat: "card", base: 47, prevSource: "CDC/NHANES (2017 ACC/AHA def.)", herit: 0.4, heritSource: "twin/family BP (est.)", pattern: "Multifactorial", syn: ["high blood pressure","bp"], icd10: "I10", snomed: "38341003" },
  { id: "chol", name: "High cholesterol", cat: "card", base: 38, prevSource: "CDC/NHANES (dyslipidemia)", herit: 0.5, heritSource: "twin LDL (est.)", pattern: "Multifactorial / possible FH", syn: ["hyperlipidemia","dyslipidemia","ldl"], icd10: "E78.5", snomed: "13644009" },
  { id: "stroke", name: "Stroke", cat: "card", base: 3, prevSource: "AHA Statistics (point prev.)", herit: 0.3, heritSource: "twin (est.)", pattern: "Multifactorial", syn: ["cva","cerebrovascular accident","brain attack"], icd10: "I63.9", snomed: "230690007" },
  { id: "afib", name: "Atrial fibrillation", cat: "card", base: 2, prevSource: "AHA/CDC (~2% adults; lifetime ~1 in 3)", herit: 0.22, heritSource: "Framingham (est.)", pattern: "Multifactorial", syn: ["irregular heartbeat","af","arrhythmia"], icd10: "I48.91", snomed: "49436004" },
  { id: "hf", name: "Heart failure", cat: "card", base: 2, prevSource: "AHA/CDC (~2% adults; lifetime ~1 in 4)", pattern: "Multifactorial", syn: ["congestive heart failure","chf"], icd10: "I50.9", snomed: "84114007" },
  { id: "aaa", name: "Abdominal aortic aneurysm", cat: "card", base: 4, pattern: "Polygenic", syn: ["aneurysm","aaa"], icd10: "I71.40", snomed: "233985008" },
  { id: "vte", name: "Venous thromboembolism", cat: "card", base: 5, pattern: "Thrombophilia / multifactorial", syn: ["blood clot","dvt","pulmonary embolism","pe"], icd10: "I82.90", snomed: "429098002" },
  { id: "cardiomyo", name: "Cardiomyopathy", cat: "card", base: 0.4, prevSource: "HCM ~1 in 500; DCM ~1 in 250–500", pattern: "Autosomal dominant", syn: ["hcm","dilated cardiomyopathy","enlarged heart"], icd10: "I42.9", snomed: "85898001", hpo: "HP:0001638" },
  { id: "longqt", name: "Long QT syndrome", cat: "card", base: 0.3, pattern: "Autosomal dominant", syn: ["lqts","arrhythmia"], icd10: "I45.81", snomed: "9651007", hpo: "HP:0001657" },
  { id: "pad", name: "Peripheral artery disease", cat: "card", base: 5, pattern: "Multifactorial", syn: ["pad","claudication"], icd10: "I73.9", snomed: "399957001" },
  { id: "mvp", name: "Mitral valve prolapse", cat: "card", base: 2, pattern: "Variable", syn: ["mvp","heart murmur"] },
  { id: "brca", name: "Breast cancer", cat: "canc", base: 13, prevSource: "SEER lifetime risk (women)", herit: 0.31, heritSource: "Mucci 2016 JAMA (PMID 26746459)", pattern: "Autosomal dominant (possible BRCA)", syn: ["breast carcinoma","brca"], icd10: "C50.919", snomed: "254837009", hpo: "HP:0100013" },
  { id: "colon", name: "Colorectal cancer", cat: "canc", base: 4.1, prevSource: "SEER lifetime risk", herit: 0.35, heritSource: "Lichtenstein 2000 (est.)", pattern: "Multifactorial / possible Lynch", syn: ["colon cancer","bowel cancer","rectal cancer"], icd10: "C18.9", snomed: "363406005", hpo: "HP:0003003" },
  { id: "prostate", name: "Prostate cancer", cat: "canc", base: 12.5, prevSource: "SEER lifetime risk (men)", herit: 0.57, heritSource: "Mucci 2016 JAMA (PMID 26746459)", pattern: "Multifactorial", syn: ["prostate carcinoma"], icd10: "C61", snomed: "399068003", hpo: "HP:0012125" },
  { id: "lung", name: "Lung cancer", cat: "canc", base: 6, prevSource: "SEER lifetime risk", herit: 0.08, heritSource: "Mucci 2016 (smoking-dominant; est.)", pattern: "Multifactorial / environmental", syn: ["lung carcinoma"], icd10: "C34.90", snomed: "93880001" },
  { id: "ovarian", name: "Ovarian cancer", cat: "canc", base: 1.1, prevSource: "SEER lifetime risk (women)", herit: 0.39, heritSource: "Mucci 2016 JAMA (PMID 26746459)", pattern: "Autosomal dominant (BRCA)", syn: ["ovary cancer"], icd10: "C56.9", snomed: "363443007", hpo: "HP:0100615" },
  { id: "panc", name: "Pancreatic cancer", cat: "canc", base: 1.7, prevSource: "SEER lifetime risk", pattern: "Multifactorial", syn: ["pancreas cancer"], icd10: "C25.9", snomed: "372003004", hpo: "HP:0002894" },
  { id: "melanoma", name: "Melanoma", cat: "canc", base: 2.3, prevSource: "SEER lifetime risk", herit: 0.58, heritSource: "Mucci 2016 JAMA (PMID 26746459)", pattern: "Multifactorial / CDKN2A", syn: ["skin cancer"], icd10: "C43.9", snomed: "2092003", hpo: "HP:0002861" },
  { id: "gastric", name: "Gastric cancer", cat: "canc", base: 0.8, prevSource: "SEER lifetime risk", pattern: "Multifactorial / CDH1", syn: ["stomach cancer"], icd10: "C16.9", snomed: "363349007", hpo: "HP:0006753" },
  { id: "endometrial", name: "Endometrial cancer", cat: "canc", base: 3.1, prevSource: "SEER lifetime risk (corpus uteri)", herit: 0.27, heritSource: "Mucci 2016 JAMA (PMID 26746459)", pattern: "Possible Lynch", syn: ["uterine cancer","womb cancer"], icd10: "C54.9", snomed: "315267003", hpo: "HP:0012114" },
  { id: "thyroidca", name: "Thyroid cancer", cat: "canc", base: 1.2, pattern: "Multifactorial / RET", syn: ["thyroid carcinoma"], icd10: "C73", snomed: "363478007" },
  { id: "kidneyca", name: "Kidney cancer", cat: "canc", base: 2, pattern: "Multifactorial / VHL", syn: ["renal cell carcinoma","rcc"], icd10: "C64.9", snomed: "702391001" },
  { id: "bladderca", name: "Bladder cancer", cat: "canc", base: 2.4, pattern: "Multifactorial", icd10: "C67.9", snomed: "399326009" },
  { id: "utuc", name: "Upper urinary tract cancer (renal pelvis/ureter)", cat: "canc", base: 0.1, prevSource: "SEER (renal pelvis/ureter; rare)", pattern: "Multifactorial / possible Lynch", syn: ["urothelial carcinoma","transitional cell carcinoma","renal pelvis cancer","ureter cancer","tcc","utuc"], icd10: "C65.9", snomed: "363457009" },
  { id: "leukemia", name: "Leukemia", cat: "canc", base: 1.5, pattern: "Multifactorial", syn: ["blood cancer","aml","cll"], icd10: "C95.90", snomed: "93143009" },
  { id: "lymphoma", name: "Non-Hodgkin lymphoma", cat: "canc", base: 2.1, pattern: "Multifactorial", syn: ["lymphoma"], icd10: "C85.90", snomed: "118601006" },
  { id: "cervical", name: "Cervical cancer", cat: "canc", base: 0.6, pattern: "HPV / environmental", icd10: "C53.9", snomed: "363354003" },
  { id: "liverca", name: "Liver cancer", cat: "canc", base: 1, pattern: "Multifactorial", syn: ["hepatocellular carcinoma","hcc"], icd10: "C22.0", snomed: "109841003" },
  { id: "brainca", name: "Brain / CNS tumor", cat: "canc", base: 0.6, pattern: "Multifactorial", syn: ["glioma","brain tumor"] },
  { id: "testicular", name: "Testicular cancer", cat: "canc", base: 0.4, pattern: "Multifactorial" },
  { id: "t2d", name: "Type 2 diabetes", cat: "endo", base: 11, prevSource: "CDC Natl Diabetes Stats 2022", herit: 0.72, heritSource: "twin, Kaprio 1992 (est.)", pattern: "Multifactorial", syn: ["diabetes","sugar","t2dm","adult onset diabetes"], icd10: "E11.9", snomed: "44054006", hpo: "HP:0005978" },
  { id: "t1d", name: "Type 1 diabetes", cat: "endo", base: 0.4, prevSource: "CDC", herit: 0.88, heritSource: "twin, Kaprio 1992 (est.)", pattern: "Autoimmune / polygenic", syn: ["juvenile diabetes","t1dm","insulin dependent"], icd10: "E10.9", snomed: "46635009", hpo: "HP:0100651" },
  { id: "thy", name: "Hypothyroidism", cat: "endo", base: 5, prevSource: "NHANES (subclinical + overt)", herit: 0.65, heritSource: "AITD twin (est.)", pattern: "Autoimmune / polygenic", syn: ["underactive thyroid","hashimoto","low thyroid"], icd10: "E03.9", snomed: "40930008", hpo: "HP:0000821" },
  { id: "hyperthy", name: "Hyperthyroidism", cat: "endo", base: 1.2, pattern: "Autoimmune", syn: ["graves disease","overactive thyroid"], icd10: "E05.90", snomed: "34486009" },
  { id: "obesity", name: "Obesity", cat: "endo", base: 42, prevSource: "CDC NHANES 2017–2020", herit: 0.6, heritSource: "twin BMI, Elks 2012 (est.)", pattern: "Multifactorial", syn: ["overweight","high bmi"], icd10: "E66.9", snomed: "414916001" },
  { id: "gout", name: "Gout", cat: "endo", base: 4, pattern: "Multifactorial", syn: ["uric acid","hyperuricemia"], icd10: "M10.9", snomed: "90560007" },
  { id: "pcos", name: "PCOS", cat: "endo", base: 8, pattern: "Multifactorial", syn: ["polycystic ovary syndrome"], icd10: "E28.2", snomed: "237055002" },
  { id: "osteoporosis", name: "Osteoporosis", cat: "endo", base: 13, prevSource: "NHANES 2017–18 (age ≥50)", herit: 0.6, heritSource: "twin BMD (est.)", pattern: "Multifactorial", syn: ["brittle bones","low bone density"], icd10: "M81.0", snomed: "64859006" },
  { id: "mody", name: "MODY diabetes", cat: "endo", base: 0.2, pattern: "Autosomal dominant", syn: ["maturity onset diabetes"] },
  { id: "metabolic", name: "Metabolic syndrome", cat: "endo", base: 33, pattern: "Multifactorial", syn: ["insulin resistance","syndrome x"] },
  { id: "addison", name: "Addison's disease", cat: "endo", base: 0.02, pattern: "Autoimmune", syn: ["adrenal insufficiency"] },
  { id: "hemochrom", name: "Hemochromatosis", cat: "endo", base: 0.4, prevSource: "HFE C282Y homozygote freq. (NH white)", pattern: "Autosomal recessive", syn: ["iron overload"], icd10: "E83.110", snomed: "35400008", hpo: "HP:0011031" },
  { id: "alz", name: "Alzheimer's disease", cat: "neuro", base: 11, prevSource: "Alzheimer's Assoc. 2024 (of age ≥65)", herit: 0.7, heritSource: "Gatz 2006 (PMID 16461860)", pattern: "Late-onset multifactorial (APOE)", syn: ["dementia","memory loss"], icd10: "G30.9", snomed: "26929004", hpo: "HP:0002511" },
  { id: "park", name: "Parkinson's disease", cat: "neuro", base: 1, prevSource: "GBD / Marras 2018 (of age ≥60)", herit: 0.3, heritSource: "twin, Wirdefeldt (est.)", pattern: "Multifactorial", syn: ["parkinsons","tremor"], icd10: "G20.A1", snomed: "49049000", hpo: "HP:0001300" },
  { id: "epilepsy", name: "Epilepsy", cat: "neuro", base: 3, pattern: "Multifactorial", syn: ["seizure disorder","seizures"], icd10: "G40.909", snomed: "84757009", hpo: "HP:0001250" },
  { id: "migraine", name: "Migraine", cat: "neuro", base: 15, pattern: "Multifactorial", syn: ["headache","migraines"], icd10: "G43.909", snomed: "37796009" },
  { id: "ms", name: "Multiple sclerosis", cat: "neuro", base: 0.3, prevSource: "Wallin 2019 Neurology (US)", herit: 0.5, heritSource: "twin (est.)", pattern: "Autoimmune / polygenic", syn: ["ms"], icd10: "G35.D", snomed: "24700007" },
  { id: "als", name: "ALS", cat: "neuro", base: 0.3, pattern: "Multifactorial / SOD1", syn: ["lou gehrig","motor neuron disease"], icd10: "G12.21", snomed: "86044005", hpo: "HP:0007354" },
  { id: "hunt", name: "Huntington's disease", cat: "neuro", base: 0.01, prevSource: "European-ancestry ~10–14 / 100k", pattern: "Autosomal dominant", syn: ["huntingtons","chorea"], icd10: "G10", snomed: "58756001", hpo: "HP:0002072" },
  { id: "vascdem", name: "Vascular dementia", cat: "neuro", base: 5, pattern: "Multifactorial", syn: ["dementia"] },
  { id: "neuropathy", name: "Peripheral neuropathy", cat: "neuro", base: 8, pattern: "Multifactorial", syn: ["nerve damage","numbness"] },
  { id: "tremor", name: "Essential tremor", cat: "neuro", base: 4, pattern: "Autosomal dominant", syn: ["shaking","tremor"] },
  { id: "rls", name: "Restless legs syndrome", cat: "neuro", base: 7, pattern: "Multifactorial", syn: ["rls"] },
  { id: "narco", name: "Narcolepsy", cat: "neuro", base: 0.05, pattern: "HLA-associated", syn: ["sleep attacks"] },
  { id: "dep", name: "Depression", cat: "ment", base: 20, prevSource: "NCS-R / NSDUH (lifetime MDD)", herit: 0.37, heritSource: "Sullivan 2000 meta (est.)", pattern: "Multifactorial", syn: ["major depressive disorder","mdd","low mood"], icd10: "F32.9", snomed: "35489007" },
  { id: "anx", name: "Anxiety disorder", cat: "ment", base: 19, prevSource: "NCS-R / NIMH (past-year)", herit: 0.3, heritSource: "Hettema 2001 meta (est.)", pattern: "Multifactorial", syn: ["gad","panic","anxiety"], icd10: "F41.9", snomed: "48694002" },
  { id: "bipolar", name: "Bipolar disorder", cat: "ment", base: 2.8, prevSource: "NCS-R (lifetime)", herit: 0.75, heritSource: "twin, McGuffin 2003 (est.)", pattern: "Multifactorial / high heritability", syn: ["manic depression","bipolar"], icd10: "F31.9", snomed: "13746004" },
  { id: "schizo", name: "Schizophrenia", cat: "ment", base: 0.7, prevSource: "McGrath 2008 (lifetime)", herit: 0.79, heritSource: "Hilker 2018 Biol Psychiatry (PMID 28987712)", pattern: "Multifactorial / high heritability", syn: ["psychosis"], icd10: "F20.9", snomed: "58214004" },
  { id: "ocd", name: "OCD", cat: "ment", base: 2.3, pattern: "Multifactorial", syn: ["obsessive compulsive disorder"], icd10: "F42.9", snomed: "191736004" },
  { id: "ptsd", name: "PTSD", cat: "ment", base: 7, pattern: "Multifactorial / environmental", syn: ["post traumatic stress"] },
  { id: "adhd", name: "ADHD", cat: "ment", base: 8, prevSource: "CDC (children); Polanczyk pooled ~5%", herit: 0.74, heritSource: "Faraone & Larsson 2019 (PMID 29892054)", pattern: "Multifactorial / high heritability", syn: ["attention deficit","add"], icd10: "F90.9", snomed: "406506008" },
  { id: "autism", name: "Autism spectrum", cat: "ment", base: 2.8, prevSource: "CDC ADDM 2020 (~1 in 36)", herit: 0.8, heritSource: "Tick 2016 (PMID 26709141)", pattern: "Multifactorial / high heritability", syn: ["asd","autistic"], icd10: "F84.0", snomed: "408856003" },
  { id: "eating", name: "Eating disorder", cat: "ment", base: 2, pattern: "Multifactorial", syn: ["anorexia","bulimia"] },
  { id: "sud", name: "Substance use disorder", cat: "ment", base: 10, pattern: "Multifactorial", syn: ["addiction","alcoholism","alcohol use disorder"] },
  { id: "ra", name: "Rheumatoid arthritis", cat: "auto", base: 0.6, prevSource: "CDC / Framingham", herit: 0.6, heritSource: "MacGregor 2000 twin (est.)", pattern: "Autoimmune / HLA", syn: ["ra","inflammatory arthritis"], icd10: "M06.9", snomed: "69896004", hpo: "HP:0001370" },
  { id: "lupus", name: "Lupus (SLE)", cat: "auto", base: 0.1, pattern: "Autoimmune", syn: ["systemic lupus","sle"], icd10: "M32.9", snomed: "55464009" },
  { id: "celiac", name: "Celiac disease", cat: "auto", base: 0.7, prevSource: "Rubio-Tapia 2012 (US)", herit: 0.75, heritSource: "twin, Nisticò 2006 (est.)", pattern: "Autoimmune (HLA-DQ2/DQ8)", syn: ["gluten intolerance","sprue"], icd10: "K90.0", snomed: "396331005", hpo: "HP:0002608" },
  { id: "psoriasis", name: "Psoriasis", cat: "auto", base: 3, pattern: "Autoimmune / polygenic", syn: ["psoriatic"], icd10: "L40.9", snomed: "9014002" },
  { id: "crohn", name: "Crohn's disease", cat: "auto", base: 0.3, prevSource: "CDC / Dahlhamer 2016", herit: 0.5, heritSource: "twin (est.)", pattern: "Autoimmune / polygenic", syn: ["ibd","crohns"], icd10: "K50.90", snomed: "34000006", hpo: "HP:0100280" },
  { id: "uc", name: "Ulcerative colitis", cat: "auto", base: 0.4, pattern: "Autoimmune / polygenic", syn: ["ibd","colitis"], icd10: "K51.90", snomed: "64766004" },
  { id: "sjogren", name: "Sjögren's syndrome", cat: "auto", base: 0.5, pattern: "Autoimmune", syn: ["dry eyes","sjogrens"] },
  { id: "scleroderma", name: "Scleroderma", cat: "auto", base: 0.05, pattern: "Autoimmune", syn: ["systemic sclerosis"] },
  { id: "vitiligo", name: "Vitiligo", cat: "auto", base: 1, pattern: "Autoimmune", syn: ["skin depigmentation"] },
  { id: "as", name: "Ankylosing spondylitis", cat: "auto", base: 0.3, pattern: "HLA-B27", syn: ["spine arthritis"] },
  { id: "asthma", name: "Asthma", cat: "resp", base: 8, prevSource: "CDC NHIS (current asthma)", herit: 0.6, heritSource: "twin, Thomsen 2010 (est.)", pattern: "Multifactorial / atopy", syn: ["wheezing","reactive airway"], icd10: "J45.909", snomed: "195967001" },
  { id: "copd", name: "COPD", cat: "resp", base: 6, prevSource: "CDC BRFSS", herit: 0.4, heritSource: "twin lung-function (est.)", pattern: "Multifactorial / environmental", syn: ["emphysema","chronic bronchitis"], icd10: "J44.9", snomed: "13645005" },
  { id: "cf", name: "Cystic fibrosis", cat: "resp", base: 0.03, prevSource: "CF Foundation Registry", pattern: "Autosomal recessive", syn: ["cf"], icd10: "E84.9", snomed: "190905008", hpo: "HP:0012236" },
  { id: "osa", name: "Obstructive sleep apnea", cat: "resp", base: 12, pattern: "Multifactorial", syn: ["sleep apnea","snoring"], icd10: "G47.33", snomed: "78275009" },
  { id: "pulmfib", name: "Pulmonary fibrosis", cat: "resp", base: 0.2, pattern: "Multifactorial", syn: ["ipf","scarred lungs"] },
  { id: "a1at", name: "Alpha-1 antitrypsin deficiency", cat: "resp", base: 0.1, pattern: "Autosomal recessive", syn: ["a1at"] },
  { id: "gerd", name: "GERD", cat: "gi", base: 20, pattern: "Multifactorial", syn: ["acid reflux","heartburn"], icd10: "K21.9", snomed: "235595009" },
  { id: "ibs", name: "Irritable bowel syndrome", cat: "gi", base: 11, pattern: "Multifactorial", syn: ["ibs"], icd10: "K58.9", snomed: "10743008" },
  { id: "gallstones", name: "Gallstones", cat: "gi", base: 10, pattern: "Multifactorial", syn: ["cholelithiasis"] },
  { id: "fattyliver", name: "Fatty liver disease", cat: "gi", base: 25, pattern: "Multifactorial", syn: ["nafld","nash"] },
  { id: "pud", name: "Peptic ulcer disease", cat: "gi", base: 8, pattern: "Multifactorial / H. pylori", syn: ["stomach ulcer","ulcer"] },
  { id: "diverticulosis", name: "Diverticulosis", cat: "gi", base: 35, pattern: "Multifactorial", syn: ["diverticulitis"] },
  { id: "pancreatitis", name: "Chronic pancreatitis", cat: "gi", base: 0.5, pattern: "Multifactorial" },
  { id: "lactose", name: "Lactose intolerance", cat: "gi", base: 20, pattern: "Genetic", syn: ["dairy intolerance"] },
  { id: "ckd", name: "Chronic kidney disease", cat: "renal", base: 14, prevSource: "CDC CKD Surveillance / USRDS", pattern: "Multifactorial", syn: ["ckd","kidney failure"], icd10: "N18.9", snomed: "709044004" },
  { id: "pkd", name: "Polycystic kidney disease", cat: "renal", base: 0.1, prevSource: "ADPKD ~1 in 1,000 (Willey 2017)", pattern: "Autosomal dominant", syn: ["pkd"], icd10: "Q61.3", snomed: "765330003", hpo: "HP:0000113" },
  { id: "kidneystones", name: "Kidney stones", cat: "renal", base: 9, pattern: "Multifactorial", syn: ["renal calculi","nephrolithiasis"] },
  { id: "bph", name: "Enlarged prostate (BPH)", cat: "renal", base: 25, pattern: "Age-related", syn: ["bph","prostate enlargement"] },
  { id: "oa", name: "Osteoarthritis", cat: "musc", base: 22, prevSource: "CDC (arthritis; OA subset)", herit: 0.5, heritSource: "twin, site-specific (est.)", pattern: "Multifactorial", syn: ["arthritis","joint degeneration"], icd10: "M19.90", snomed: "396275006" },
  { id: "backpain", name: "Chronic low back pain", cat: "musc", base: 13, pattern: "Multifactorial", syn: ["back pain"] },
  { id: "fibro", name: "Fibromyalgia", cat: "musc", base: 2, pattern: "Multifactorial", syn: ["chronic pain"] },
  { id: "md", name: "Muscular dystrophy", cat: "musc", base: 0.02, pattern: "X-linked / recessive", syn: ["dmd","muscle wasting"], hpo: "HP:0003560" },
  { id: "ehlers", name: "Ehlers-Danlos syndrome", cat: "musc", base: 0.02, pattern: "Variable inheritance", syn: ["eds","hypermobility"], hpo: "HP:0001382" },
  { id: "scoliosis", name: "Scoliosis", cat: "musc", base: 3, pattern: "Multifactorial", syn: ["curved spine"] },
  { id: "anemia", name: "Iron-deficiency anemia", cat: "blood", base: 5, pattern: "Multifactorial", syn: ["low iron","anaemia"] },
  { id: "sickle", name: "Sickle cell disease", cat: "blood", base: 0.03, prevSource: "CDC (~1 in 365 Black births; ancestry-specific)", pattern: "Autosomal recessive", syn: ["sickle cell anemia"], icd10: "D57.1", snomed: "127040003", hpo: "HP:0045047" },
  { id: "thalassemia", name: "Thalassemia", cat: "blood", base: 0.1, pattern: "Autosomal recessive" },
  { id: "hemophilia", name: "Hemophilia", cat: "blood", base: 0.01, pattern: "X-linked recessive", syn: ["bleeding disorder"], icd10: "D66", snomed: "90935002", hpo: "HP:0003125" },
  { id: "g6pd", name: "G6PD deficiency", cat: "blood", base: 0.5, pattern: "X-linked", syn: ["g6pd"], hpo: "HP:0034060" },
  { id: "factorv", name: "Factor V Leiden", cat: "blood", base: 5, prevSource: "~3–8% European ancestry (heterozygous)", pattern: "Autosomal dominant / thrombophilia", syn: ["clotting disorder","thrombophilia"], icd10: "D68.51", snomed: "307091009", hpo: "HP:0012175" },
  { id: "vwd", name: "Von Willebrand disease", cat: "blood", base: 1, pattern: "Autosomal dominant", syn: ["bleeding disorder","vwd"] },
  { id: "glaucoma", name: "Glaucoma", cat: "sens", base: 3, pattern: "Multifactorial", syn: ["eye pressure"], icd10: "H40.9", snomed: "23986001" },
  { id: "amd", name: "Macular degeneration", cat: "sens", base: 2, pattern: "Multifactorial / CFH", syn: ["amd","vision loss"], icd10: "H35.30", snomed: "267718000" },
  { id: "cataracts", name: "Cataracts", cat: "sens", base: 20, pattern: "Age-related / multifactorial", syn: ["cloudy lens"] },
  { id: "hearingloss", name: "Age-related hearing loss", cat: "sens", base: 20, pattern: "Multifactorial", syn: ["presbycusis","deafness"] },
  { id: "colorblind", name: "Color blindness", cat: "sens", base: 4, pattern: "X-linked recessive", syn: ["color vision deficiency"], hpo: "HP:0000551" },
  { id: "retinitis", name: "Retinitis pigmentosa", cat: "sens", base: 0.03, pattern: "Variable inheritance", syn: ["rp","night blindness"], hpo: "HP:0000510" },
  { id: "eczema", name: "Eczema (atopic dermatitis)", cat: "sens", base: 10, pattern: "Multifactorial / atopy", syn: ["dermatitis","atopic"] },
  { id: "endometriosis", name: "Endometriosis", cat: "repro", base: 10, pattern: "Multifactorial", syn: ["endo"], icd10: "N80.9", snomed: "129103003" },
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

