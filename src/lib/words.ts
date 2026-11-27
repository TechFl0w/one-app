const one = (w: string) =>
  /ies$/i.test(w) ? w.replace(/ies$/i, "y") : /(ss|us|is)$/i.test(w) ? w : /(ches|shes|xes|sses|uses)$/i.test(w) ? w.replace(/es$/i, "") : w.replace(/s$/i, "");

/** "Clients" → "Client", "Parts used" → "Part used", "Job lines" → "Job line", "Statuses" → "Status". */
export function singular(label: string): string {
  const words = label.split(" ");
  // The plural is usually the first word ("Parts used"), else the last ("Job lines").
  const i = words.length > 1 && !/s$/i.test(words[0]) && /s$/i.test(words[words.length - 1]) ? words.length - 1 : 0;
  return words.map((w, n) => (n === i ? one(w) : w)).join(" ");
}
