export type ExtractableMessage = {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
  sourceUrl: string;
  provider?: "gmail" | "daum";
};

export type ExtractedCandidate = {
  id: number;
  title: string;
  type: string;
  sender: string;
  email: string;
  sourceUrl: string;
  summary: string;
  location: string;
  date: string;
  time: string;
  endTime: string;
  timeAmbiguous: boolean;
  deadline?: string;
  needsReview: boolean;
  selected: boolean;
};

const taskKeywords = /(회의|미팅|면담|일정|약속|회신|답변|제출|마감|기한|계약|갱신|검토|보고서|자료|세미나|웨비나|인터뷰|meeting|deadline|submit|reply|respond|due|appointment|schedule|review)/i;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function validDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${pad(month)}-${pad(day)}`;
}

function extractDate(text: string, receivedAt: string): { value: string; ambiguous: boolean } {
  const iso = text.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (iso) return { value: validDate(Number(iso[1]), Number(iso[2]), Number(iso[3])), ambiguous: false };

  const received = new Date(receivedAt);
  const base = Number.isNaN(received.getTime()) ? new Date() : received;
  const korean = text.match(/(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) return { value: validDate(Number(korean[1] ?? base.getFullYear()), Number(korean[2]), Number(korean[3])), ambiguous: false };

  const relativeDays = text.includes("모레") ? 2 : text.includes("내일") ? 1 : text.includes("오늘") ? 0 : null;
  if (relativeDays !== null) {
    const date = new Date(base);
    date.setDate(date.getDate() + relativeDays);
    return { value: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, ambiguous: false };
  }

  return { value: "", ambiguous: /(다음\s*주|이번\s*주|주말|월말|빠른\s*시일|조만간|soon|next week)/i.test(text) };
}

function normalizeKoreanTime(period: string | undefined, hourText: string, minuteText?: string): string {
  let hour = Number(hourText);
  if (period === "오후" && hour < 12) hour += 12;
  if (period === "오전" && hour === 12) hour = 0;
  return hour <= 23 ? `${pad(hour)}:${pad(Number(minuteText ?? 0))}` : "";
}

function plusHours(time: string, hours: number): string {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour * 60 + minute + hours * 60) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function extractTime(text: string): { value: string; endValue: string; ambiguous: boolean } {
  const clockRange = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:~|～|–|—|-|부터)\s*([01]?\d|2[0-3]):([0-5]\d)(?:까지)?\b/);
  if (clockRange) return { value: `${pad(Number(clockRange[1]))}:${clockRange[2]}`, endValue: `${pad(Number(clockRange[3]))}:${clockRange[4]}`, ambiguous: false };
  const koreanRange = text.match(/(오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?\s*(?:~|～|–|—|-|부터)\s*(오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?(?:까지)?/);
  if (koreanRange) {
    const start = normalizeKoreanTime(koreanRange[1], koreanRange[2], koreanRange[3]);
    const end = normalizeKoreanTime(koreanRange[4] ?? koreanRange[1], koreanRange[5], koreanRange[6]);
    if (start && end) return { value: start, endValue: end, ambiguous: false };
  }
  const clock = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (clock) {
    const value = `${pad(Number(clock[1]))}:${clock[2]}`;
    return { value, endValue: plusHours(value, 3), ambiguous: false };
  }
  const korean = text.match(/(오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/);
  if (korean) {
    const value = normalizeKoreanTime(korean[1], korean[2], korean[3]);
    if (value) return { value, endValue: plusHours(value, 3), ambiguous: false };
  }
  return { value: "", endValue: "", ambiguous: /(오전\s*중|오후\s*중|업무\s*시간|퇴근\s*전|중으로|morning|afternoon|end of day)/i.test(text) };
}

function todayInKorea(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function classify(text: string): string {
  if (/(회신|답변|reply|respond)/i.test(text)) return "회신";
  if (/(제출|보고서|자료|submit)/i.test(text)) return "자료 제출";
  if (/(계약|갱신)/i.test(text)) return "계약";
  if (/(회의|미팅|면담|meeting|interview)/i.test(text)) return "회의";
  if (/(마감|기한|deadline|due)/i.test(text)) return "마감";
  return "후속 업무";
}

function conciseTitle(subject: string, type: string): string {
  const cleaned = subject
    .replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/^\s*(?:\[(?:안내|공지|초대|요청|일정|알림)\]\s*)+/gi, "")
    .replace(/\b20\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/g, "")
    .replace(/(?:(?:20\d{2})년\s*)?\d{1,2}월\s*\d{1,2}일/g, "")
    .replace(/(?:오전|오후)?\s*\d{1,2}시(?:\s*\d{1,2}분)?/g, "")
    .replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g, "")
    .replace(/(?:관련\s*)?(?:일정\s*)?(?:안내|공지|초대|참석\s*요청|회신\s*요청)$/g, "")
    .replace(/\s*[-–—|:]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = `${type} 일정`;
  const value = cleaned || fallback;
  if (value.length <= 60) return value;
  const shortened = value.slice(0, 60).replace(/\s+\S*$/, "").trim();
  return shortened || value.slice(0, 60);
}

function summarizeSnippet(snippet: string): string {
  const normalized = snippet.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= 100) return normalized;
  return `${normalized.slice(0, 99).trimEnd()}…`;
}

function extractLocation(snippet: string): string {
  const match = snippet.match(/(?:^|[\n\r])\s*(?:장소|위치|회의실)\s*[:：]\s*([^\n\r]{1,120})/i)
    ?? snippet.match(/(?:장소|위치|회의실)\s*[:：]\s*([^|]{1,120})/i);
  if (!match) return "";
  return match[1]
    .split(/\s+(?=(?:일시|시간|문의|준비물|안내)\s*[:：])/)[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function extractScheduleCandidates(messages: ExtractableMessage[]): ExtractedCandidate[] {
  return messages.flatMap((message) => {
    if (/^\s*(?:\(광고\)|\[광고\]|광고[: ])/i.test(message.subject)) return [];
    const text = `${message.subject} ${message.snippet}`.replace(/\s+/g, " ");
    if (!taskKeywords.test(text)) return [];
    const date = extractDate(text, message.receivedAt);
    const time = extractTime(text);
    const type = classify(text);
    const resolvedDate = date.value || (date.ambiguous ? "" : todayInKorea());
    return [{
      id: 0,
      title: conciseTitle(message.subject, type),
      type,
      sender: message.from || "발신자 정보 없음",
      email: message.subject || "제목 없음",
      sourceUrl: message.sourceUrl,
      summary: summarizeSnippet(message.snippet),
      location: extractLocation(message.snippet),
      date: resolvedDate,
      time: time.value,
      endTime: time.endValue,
      timeAmbiguous: time.ambiguous,
      deadline: /(마감|기한|까지|deadline|due)/i.test(text) ? [resolvedDate, time.value].filter(Boolean).join(" ") || "[확인 필요]" : undefined,
      needsReview: date.ambiguous || time.ambiguous,
      selected: false,
    }];
  }).slice(0, 40).map((candidate, index) => ({ ...candidate, id: index + 1 }));
}
