/**
 * Viser logoen, med navnet som tekst hvis bildet ikke finnes.
 *
 * Fallgruven som gjorde dette til en egen fil: ES-moduler er deferred, så
 * nettleseren har ofte allerede prøvd og mislykket med bildet før koden vår
 * kjører. Da har `error`-hendelsen gått tapt, og en ren lytter er ikke nok
 * — resultatet er et knust bildeikon i panelet. Derfor sjekkes også
 * tilstanden etterpå.
 */
export function visLogoEllerTekst(bildeId: string, tittelId: string, tekst: string): void {
  const img = document.getElementById(bildeId) as HTMLImageElement | null;
  const tittel = document.getElementById(tittelId);
  if (!img || !tittel) return;

  const tilTekst = (): void => {
    tittel.textContent = tekst;
  };
  img.addEventListener("error", tilTekst);
  // complete = ferdig forsøkt; naturalWidth 0 = det gikk ikke.
  if (img.complete && img.naturalWidth === 0) tilTekst();
}
