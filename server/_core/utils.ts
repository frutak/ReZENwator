/**
 * Common Polish and English first names to help heuristics.
 */
const COMMON_FIRST_NAMES = new Set([
  // Polish Male
  "adam", "andrzej", "antoni", "arkadiusz", "artur", "bartosz", "bartłomiej", "bogdan", "czesław", "damian", "dariusz", "dawid", "dominik", "edward", "eugeniusz", "filip", "franciszek", "grzegorz", "henryk", "hubert", "ireneusz", "jacek", "jakub", "jan", "janusz", "jarosław", "jerzy", "joachim", "józef", "kamil", "karol", "kazimierz", "konrad", "krystian", "krzysztof", "leszek", "lucjan", "łukasz", "maciej", "marcin", "marek", "marian", "mariusz", "mateusz", "michał", "mieczysław", "mirosław", "paweł", "piotr", "przemysław", "radosław", "rafał", "robert", "roman", "ryszard", "sebastian", "sławomir", "stanisław", "stefan", "szymon", "tadeusz", "tomasz", "waldemar", "wiesław", "wiktor", "witold", "władysław", "wojciech", "zbigniew", "zdzisław", "zenon",
  // Polish Female
  "agata", "agnieszka", "alicja", "alina", "amalia", "anastazja", "andżelika", "ania", "anna", "antonina", "beata", "bogumiła", "bożena", "barbara", "cecyla", "danuta", "dorota", "edyta", "elżbieta", "emilia", "eugenika", "ewa", "ewelina", "felicja", "grażyna", "halina", "hanna", "helena", "irena", "iwona", "jadwiga", "janina", "joanna", "jolanta", "julia", "justyna", "kamila", "karolina", "katarzyna", "kazimiera", "kinga", "krystyna", "leokadia", "lidia", "lucyna", "ludmiła", "magdalena", "małgorzata", "maria", "marianna", "marta", "marzena", "monika", "natalia", "oliwia", "patrycja", "paula", "regina", "renata", "sabina", "stanisława", "stefania", "teresy", "urszula", "wanda", "weronika", "wiesława", "wiktorii", "wioletta", "zofia", "zuzanna",
  // English Male
  "aaron", "adam", "alan", "albert", "alex", "alexander", "alfred", "andrew", "anthony", "arthur", "austin", "benjamin", "bernard", "billy", "bob", "brian", "bruce", "carl", "charles", "christian", "christopher", "clarence", "clark", "claude", "clifford", "curtis", "daniel", "david", "dennis", "donald", "douglas", "earl", "edward", "edwin", "eric", "ernest", "eugene", "francis", "frank", "fred", "frederick", "gary", "george", "gerald", "gilbert", "gregory", "harold", "harry", "henry", "herbert", "howard", "hubert", "hugh", "isaac", "jack", "jacob", "james", "jason", "jeffrey", "jeremy", "jerry", "jesse", "joe", "john", "johnny", "jonathan", "joseph", "joshua", "justin", "keith", "kenneth", "kevin", "larry", "lawrence", "leonard", "lewis", "louis", "mark", "martin", "matthew", "melvin", "michael", "nathan", "nicholas", "norman", "oscar", "patrick", "paul", "peter", "philip", "ralph", "raymond", "richard", "robert", "roger", "ronald", "roy", "russell", "samuel", "scott", "stephen", "steven", "terry", "thomas", "timothy", "victor", "walter", "warren", "wayne", "william", "willie",
  // English Female
  "alice", "amanda", "amy", "angela", "ann", "anna", "anne", "annie", "barbara", "betty", "beverly", "bonnie", "brenda", "carol", "carolyn", "catherine", "cheryl", "christina", "christine", "cynthia", "deborah", "debra", "diana", "diane", "dolores", "donna", "doris", "dorothy", "edith", "edna", "eileen", "elaine", "eleanor", "elizabeth", "ellen", "elsie", "emily", "emma", "esther", "ethel", "evelyn", "florence", "frances", "gladys", "gloria", "grace", "hazel", "helen", "irene", "jacqueline", "jane", "janet", "janice", "jean", "joan", "joice", "josephine", "joyce", "juanita", "judith", "judy", "julia", "june", "karen", "katherine", "kathleen", "kathryn", "kay", "kelly", "laura", "lillian", "linda", "lois", "loretta", "lorraine", "lucille", "mabel", "margaret", "marie", "marion", "marjorie", "martha", "mary", "maxine", "mildred", "nancy", "nellie", "norma", "patricia", "paula", "peggy", "phyllis", "rachel", "rebecca", "rita", "roberta", "rose", "ruby", "ruth", "sandra", "sarah", "sharon", "shirley", "stephenie", "susan", "theresa", "velma", "vera", "virginia", "vivian", "wanda", "wilma",
]);

/**
 * Predicts the first name from a full name string using heuristics.
 */
export function predictFirstName(fullName: string | null): string {
  if (!fullName) return "Guest";

  // Clean and split
  const parts = fullName.trim().split(/\s+/).filter(p => p.length > 0);
  if (parts.length === 0) return "Guest";
  if (parts.length === 1) return parts[0]!;

  // Ignore titles
  const titles = new Set(["mr", "ms", "mrs", "miss", "pan", "pani", "dr", "prof"]);
  const cleanParts = parts.filter(p => !titles.has(p.toLowerCase().replace(/\.$/, "")));

  if (cleanParts.length === 0) return parts[0]!;
  if (cleanParts.length === 1) return cleanParts[0]!;

  // Heuristic: Check if one of the words is in our common first names list
  const lower0 = cleanParts[0]!.toLowerCase();
  const lower1 = cleanParts[1]!.toLowerCase();

  const is0Known = COMMON_FIRST_NAMES.has(lower0);
  const is1Known = COMMON_FIRST_NAMES.has(lower1);

  if (is0Known && !is1Known) return cleanParts[0]!;
  if (is1Known && !is0Known) return cleanParts[1]!;

  // Heuristic: ALL CAPS is often surname
  const is0Upper = cleanParts[0] === cleanParts[0]!.toUpperCase() && cleanParts[0]!.length > 1;
  const is1Upper = cleanParts[1] === cleanParts[1]!.toUpperCase() && cleanParts[1]!.length > 1;

  if (is0Upper && !is1Upper) return cleanParts[1]!;
  if (is1Upper && !is0Upper) return cleanParts[0]!;

  // Heuristic: Polish female names end in 'a'
  const is0FemaleA = lower0.endsWith("a") && lower0.length > 2;
  const is1FemaleA = lower1.endsWith("a") && lower1.length > 2;

  if (is0FemaleA && !is1FemaleA) return cleanParts[0]!;
  if (is1FemaleA && !is0FemaleA) return cleanParts[1]!;

  // Default to the first part
  return cleanParts[0]!;
}
