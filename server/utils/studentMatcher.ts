export function normalizeStudentName(name: string | null | undefined): string {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function phoneticClean(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ow/g, "ou")
    .replace(/w/g, "v")
    .replace(/bh/g, "b")
    .replace(/dh/g, "d")
    .replace(/th/g, "t")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/sh/g, "s")
    .replace(/(.)\1+/g, "$1") // deduplicate double letters like ll -> l, mm -> m
    .trim();
}

export function normalizePhoneNumber(phone: string | number | null | undefined): string {
  if (!phone) return "";
  const cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    return cleaned.slice(2);
  }
  return cleaned;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

function tokenSimilarity(t1: string, t2: string): number {
  if (t1 === t2) return 1.0;
  // Initial match: e.g. "D" vs "DARLA"
  if ((t1.length === 1 && t2.startsWith(t1)) || (t2.length === 1 && t1.startsWith(t2))) {
    return 0.85;
  }
  // Trailing 'a' difference: e.g. "RAVITEJ" vs "RAVITEJA"
  if (t1 + "a" === t2 || t2 + "a" === t1) {
    return 0.95;
  }
  // Substring or edit distance
  const maxLen = Math.max(t1.length, t2.length);
  const dist = levenshteinDistance(t1, t2);
  if (dist <= 1 && maxLen >= 4) return 0.90;
  if (dist <= 2 && maxLen >= 7) return 0.80;

  return Math.max(0, 1 - dist / maxLen);
}

export function calculateStringSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;

  const c1 = phoneticClean(s1);
  const c2 = phoneticClean(s2);
  if (c1 === c2) return 1.0;

  const t1 = c1.split(" ").filter(Boolean);
  const t2 = c2.split(" ").filter(Boolean);

  let totalMatched = 0;
  const usedT2 = new Set<number>();

  for (const token1 of t1) {
    let bestMatch = 0;
    let bestIdx = -1;
    for (let j = 0; j < t2.length; j++) {
      if (usedT2.has(j)) continue;
      const sim = tokenSimilarity(token1, t2[j]);
      if (sim > bestMatch) {
        bestMatch = sim;
        bestIdx = j;
      }
    }
    if (bestMatch >= 0.70 && bestIdx !== -1) {
      totalMatched += bestMatch;
      usedT2.add(bestIdx);
    }
  }

  const tokenScore = totalMatched / Math.max(t1.length, t2.length);

  // Bigram Dice score as fallback check
  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) bigrams.add(str.slice(i, i + 2));
    return bigrams;
  };
  const b1 = getBigrams(c1);
  const b2 = getBigrams(c2);
  let common = 0;
  for (const b of b1) {
    if (b2.has(b)) common++;
  }
  const dice = (b1.size + b2.size) > 0 ? (2 * common) / (b1.size + b2.size) : 0;

  return Math.max(tokenScore, dice);
}

export interface StudentCandidate {
  id: number;
  name: string;
  admissionno?: string | null;
  classId?: number;
  parents?: Array<{
    parent: {
      id?: number;
      name?: string | null;
      relation?: string | null;
      phone1?: string | null;
      phone2?: string | null;
    };
  }>;
}

export interface MatchResult {
  student: StudentCandidate | null;
  method: "EXACT_NAME" | "FATHER_PHONE" | "MOTHER_PHONE" | "ALT_PHONE" | "FUZZY_NAME" | "MANUAL" | "NONE";
  confidence: number;
  details: string;
}

export function matchStudentRecord(
  excelName: string,
  excelPhone: string | number | null | undefined,
  candidates: StudentCandidate[],
  minFuzzyThreshold = 0.65
): MatchResult {
  const normExcelName = normalizeStudentName(excelName);
  const normExcelPhone = normalizePhoneNumber(excelPhone);

  if (!normExcelName && !normExcelPhone) {
    return { student: null, method: "NONE", confidence: 0, details: "No name or phone provided" };
  }

  // 1. Exact normalized name match
  const exactNameMatch = candidates.find(
    (c) => normalizeStudentName(c.name) === normExcelName
  );
  if (exactNameMatch) {
    return {
      student: exactNameMatch,
      method: "EXACT_NAME",
      confidence: 1.0,
      details: `Matched exact name: "${exactNameMatch.name}"`,
    };
  }

  // 2. Parent contact number fallback (Priority: Father first, then Mother, then Alt)
  if (normExcelPhone && normExcelPhone.length >= 7) {
    // 2a. Father phone1
    const fatherMatches = candidates.filter((c) =>
      c.parents?.some(
        (p) =>
          p.parent?.relation === "Father" &&
          normalizePhoneNumber(p.parent?.phone1) === normExcelPhone
      )
    );

    if (fatherMatches.length === 1) {
      return {
        student: fatherMatches[0],
        method: "FATHER_PHONE",
        confidence: 0.96,
        details: `Matched Father phone: ${normExcelPhone}`,
      };
    } else if (fatherMatches.length > 1) {
      let bestSibling: StudentCandidate = fatherMatches[0];
      let bestSiblingScore = -1;
      for (const sibling of fatherMatches) {
        const score = calculateStringSimilarity(normExcelName, normalizeStudentName(sibling.name));
        if (score > bestSiblingScore) {
          bestSiblingScore = score;
          bestSibling = sibling;
        }
      }
      return {
        student: bestSibling,
        method: "FATHER_PHONE",
        confidence: 0.93,
        details: `Disambiguated sibling via Father phone: ${normExcelPhone}`,
      };
    }

    // 2b. Mother phone1
    const motherMatches = candidates.filter((c) =>
      c.parents?.some(
        (p) =>
          p.parent?.relation === "Mother" &&
          normalizePhoneNumber(p.parent?.phone1) === normExcelPhone
      )
    );

    if (motherMatches.length === 1) {
      return {
        student: motherMatches[0],
        method: "MOTHER_PHONE",
        confidence: 0.95,
        details: `Matched Mother phone: ${normExcelPhone}`,
      };
    } else if (motherMatches.length > 1) {
      let bestSibling: StudentCandidate = motherMatches[0];
      let bestSiblingScore = -1;
      for (const sibling of motherMatches) {
        const score = calculateStringSimilarity(normExcelName, normalizeStudentName(sibling.name));
        if (score > bestSiblingScore) {
          bestSiblingScore = score;
          bestSibling = sibling;
        }
      }
      return {
        student: bestSibling,
        method: "MOTHER_PHONE",
        confidence: 0.92,
        details: `Disambiguated sibling via Mother phone: ${normExcelPhone}`,
      };
    }

    // 2c. Alternate / secondary phone
    const altMatches = candidates.filter((c) =>
      c.parents?.some((p) => {
        const p1 = normalizePhoneNumber(p.parent?.phone1);
        const p2 = normalizePhoneNumber(p.parent?.phone2);
        return p1 === normExcelPhone || p2 === normExcelPhone;
      })
    );

    if (altMatches.length === 1) {
      return {
        student: altMatches[0],
        method: "ALT_PHONE",
        confidence: 0.90,
        details: `Matched parent alternate phone: ${normExcelPhone}`,
      };
    } else if (altMatches.length > 1) {
      let bestSibling: StudentCandidate = altMatches[0];
      let bestSiblingScore = -1;
      for (const sibling of altMatches) {
        const score = calculateStringSimilarity(normExcelName, normalizeStudentName(sibling.name));
        if (score > bestSiblingScore) {
          bestSiblingScore = score;
          bestSibling = sibling;
        }
      }
      return {
        student: bestSibling,
        method: "ALT_PHONE",
        confidence: 0.88,
        details: `Disambiguated sibling via alternate phone: ${normExcelPhone}`,
      };
    }
  }

  // 3. Fuzzy name match fallback
  let bestScore = 0;
  let bestCandidate: StudentCandidate | null = null;
  for (const cand of candidates) {
    const score = calculateStringSimilarity(normExcelName, normalizeStudentName(cand.name));
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  if (bestCandidate && bestScore >= minFuzzyThreshold) {
    return {
      student: bestCandidate,
      method: "FUZZY_NAME",
      confidence: Math.round(bestScore * 100) / 100,
      details: `Fuzzy name match: "${bestCandidate.name}" (${Math.round(bestScore * 100)}% match)`,
    };
  }

  return {
    student: null,
    method: "NONE",
    confidence: 0,
    details: `No match found for "${excelName}"`,
  };
}
