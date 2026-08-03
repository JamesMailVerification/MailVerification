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
  date: string;
  time: string;
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

function extractTime(text: string): { value: string; ambiguous: boolean } {
  const clock = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (clock) return { value: `${pad(Number(clock[1]))}:${clock[2]}`, ambiguous: false };
  const korean = text.match(/(오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/);
  if (korean) {
    let hour = Number(korean[2]);
    if (korean[1] === "오후" && hour < 12) hour += 12;
    if (korean[1] === "오전" && hour === 12) hour = 0;
    if (hour <= 23) return { value: `${pad(hour)}:${pad(Number(korean[3] ?? 0))}`, ambiguous: false };
  }
  return { value: "", ambiguous: /(오전\s*중|오후\s*중|업무\s*시간|퇴근\s*전|중으로|morning|afternoon|end of day)/i.test(text) };
}

function classify(text: string): string {
  if (/(회신|답변|reply|respond)/i.test(text)) return "회신";
  if (/(제출|보고서|자료|submit)/i.test(text)) return "자료 제출";
  if (/(계약|갱신)/i.test(text)) return "계약";
  if (/(회의|미팅|면담|meeting|interview)/i.test(text)) return "회의";
  if (/(마감|기한|deadline|due)/i.test(text)) return "마감";
  return "후속 업무";
}

export function extractScheduleCandidates(messages: ExtractableMessage[]): ExtractedCandidate[] {
  return messages.flatMap((message) => {
    if (/^\s*(?:\(광고\)|\[광고\]|광고[: ])/i.test(message.subject)) return [];
    const text = `${message.subject} ${message.snippet}`.replace(/\s+/g, " ");
    if (!taskKeywords.test(text)) return [];
    const date = extractDate(text, message.receivedAt);
    const time = extractTime(text);
    const hasExplicitTiming = Boolean(date.value || time.value || date.ambiguous || time.ambiguous || /(마감|기한|까지|deadline|due)/i.test(text));
    if (!hasExplicitTiming) return [];
    return [{
      id: 0,
      title: message.subject || "제목 없음",
      type: classify(text),
      sender: message.from || "발신자 정보 없음",
      email: message.subject || "제목 없음",
      sourceUrl: message.sourceUrl,
      date: date.value,
      time: time.value,
      deadline: /(마감|기한|까지|deadline|due)/i.test(text) ? [date.value, time.value].filter(Boolean).join(" ") || "[확인 필요]" : undefined,
      needsReview: !date.value || !time.value || date.ambiguous || time.ambiguous,
      selected: false,
    }];
  }).slice(0, 40).map((candidate, index) => ({ ...candidate, id: index + 1 }));
}
