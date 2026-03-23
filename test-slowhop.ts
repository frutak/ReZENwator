import { parseSlowhoEmail, detectEmailSource } from "./server/workers/emailParsers";

const slowhopSubject = "Rezerwacja od: Katarzyna Wysocka została potwierdzona";
const slowhopBody = `Przedpłata została opłacona. Możesz szykować pościel na przyjazd Gości. :)

Bezpośredni kontakt do Gości:
Nr telefonu: 48607993667
Adres e-mail: wysockacm@gmail.com
Rezerwacja nr 1204742:
Gdzie
Hacjenda Kiekrz Hacjenda na wyłączność
Kiedy
21-06-2026 - 29-06-2026
Z kim
5  dorosłych + 0 dzieci + 1 zwierząt

Cena całkowita: 4040 pln
Wysokość opłaconej przedpłaty: 1212 pln
Pozostała kwota do zapłaty: 2828 pln

Dodatkowe informacje dla Gości:
Cały dom bez wyżywienia


Regulamin i zasady anulacji:
zapraszamy serdecznie
Zobacz rezerwację na Slowhop
Pozdrawiamy :)
Zespół Slowhopa`;

console.log("Detecting Slowhop source...");
const source = detectEmailSource("rezerwacje@slowhop.com", slowhopSubject, slowhopBody);
console.log("Source:", source);

console.log("\nParsing Slowhop email...");
const parsed = parseSlowhoEmail(slowhopSubject, slowhopBody);
console.log("Parsed:", JSON.stringify(parsed, null, 2));
