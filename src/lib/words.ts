/** "Clients" → "Client", "Parts used" → "Part used", "Statuses" → "Status", "Repairs" → "Repair". */
export function singular(label: string): string {
  const words = label.split(" ");
  const w = words[0];
  const one = /ies$/i.test(w) ? w.replace(/ies$/i, "y") : /(ss|us|is)$/i.test(w) ? w : /(ches|shes|xes|sses|uses)$/i.test(w) ? w.replace(/es$/i, "") : w.replace(/s$/i, "");
  return [one, ...words.slice(1)].join(" ");
}
