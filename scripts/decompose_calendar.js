const fs = require('fs');

const code = fs.readFileSync('client/src/pages/CalendarView.tsx', 'utf8');

function extractBlock(startMarker, endMarker) {
  const startIdx = code.indexOf(startMarker);
  if (startIdx === -1) return null;
  const endIdx = code.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;
  return code.substring(startIdx, endIdx);
}

// Extract sections based on comments
const consts = extractBlock('// ─── Channel colours ──────────────────────────────────────────────────────────', '// ─── Cleaning Date Cell ───────────────────────────────────────────────────────') 
  || extractBlock('// ─── Channel colours ──────────────────────────────────────────────────────────', 'function CleaningDateCell');

const cleaningTable = extractBlock('function CleaningDateCell', '// ─── Cleaning Slot Modal ───────────────────────────────────────────────────────');
const cleaningSlot = extractBlock('// ─── Cleaning Slot Modal ───────────────────────────────────────────────────────', '// ─── Property Calendar Component ──────────────────────────────────────────────');
const propCal = extractBlock('// ─── Property Calendar Component ──────────────────────────────────────────────', '// ─── Legends ──────────────────────────────────────────────────────────────────');
const legends = extractBlock('// ─── Legends ──────────────────────────────────────────────────────────────────', '// ─── Main Calendar Page ───────────────────────────────────────────────────────');
const mainPage = extractBlock('// ─── Main Calendar Page ───────────────────────────────────────────────────────', code.length + ''); // read to end

// If we couldn't parse properly, abort
if (!consts || !cleaningTable || !cleaningSlot || !propCal || !legends || !mainPage) {
  console.log("Failed to parse blocks. Aborting.");
  process.exit(1);
}

fs.mkdirSync('client/src/components/calendar', { recursive: true });

fs.writeFileSync('client/src/components/calendar/constants.ts', `
${consts.trim()}
export { CHANNEL_COLORS, CHANNEL_LABELS, CLEANING_COLORS, BOOKING_INFO_COLORS };
`);

// The script will write out individual files with the necessary imports. Since writing exact React imports programmatically is tedious and error-prone (finding all used hooks/icons), it might be better to write the files and then use tsc / eslint to fix them, or just copy the main imports block to all of them.

const mainImports = code.substring(0, code.indexOf('// ───'));

function createComponentFile(content) {
  return `${mainImports}
import { CHANNEL_COLORS, CHANNEL_LABELS, CLEANING_COLORS, BOOKING_INFO_COLORS } from "./constants";
${content.trim()}
`;
}

fs.writeFileSync('client/src/components/calendar/CleaningTableView.tsx', createComponentFile(cleaningTable) + '\nexport { CleaningDateCell, CleaningTableView };');
fs.writeFileSync('client/src/components/calendar/CleaningSlotModal.tsx', createComponentFile(cleaningSlot) + '\nexport { CleaningSlotModal };');
fs.writeFileSync('client/src/components/calendar/PropertyCalendar.tsx', createComponentFile(propCal) + '\nexport { PropertyCalendar };');
fs.writeFileSync('client/src/components/calendar/Legends.tsx', createComponentFile(legends) + '\nexport { BookingLegend, CleaningLegend };');

// Update CalendarView.tsx
fs.writeFileSync('client/src/pages/CalendarView.tsx', `${mainImports}
import { BookingLegend, CleaningLegend } from "@/components/calendar/Legends";
import { PropertyCalendar } from "@/components/calendar/PropertyCalendar";
import { CleaningSlotModal } from "@/components/calendar/CleaningSlotModal";
import { CleaningTableView } from "@/components/calendar/CleaningTableView";

${mainPage.trim()}
`);

console.log("Decomposition successful!");
