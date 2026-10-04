/** Default for the onboarding field so most students only have to confirm: "Segundo semestre 2026". */
export function suggestPeriodName(today: Date = new Date()): string {
  const semester = today.getMonth() < 6 ? 'Primer' : 'Segundo';
  return `${semester} semestre ${today.getFullYear()}`;
}
