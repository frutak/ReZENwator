const fs = require('fs');

const code = fs.readFileSync('client/src/pages/CalendarView.tsx', 'utf8');

function extractBlock(startStr, endStr) {
  const startIdx = code.indexOf(startStr);
  if (startIdx === -1) return null;
  const endIdx = endStr ? code.indexOf(endStr, startIdx) : code.length;
  if (endIdx === -1) return null;
  return code.substring(startIdx, endIdx);
}

// Extract sections based on actual comments from the file
const constsIdx = code.indexOf('// ─── Channel colours');
const mainImports = code.substring(0, constsIdx);

// The constants section
const constsEndIdx = code.indexOf('function CleaningDateCell');
const consts = code.substring(constsIdx, constsEndIdx);

const cleaningTableIdx = constsEndIdx;
const cleaningSlotIdx = code.indexOf('// ─── Cleaning Slot Modal');
const propCalIdx = code.indexOf('// ─── Property Calendar Component');
const legendsIdx = code.indexOf('// ─── Legends');
const mainPageIdx = code.indexOf('// ─── Main Calendar Page');

const cleaningTable = code.substring(cleaningTableIdx, cleaningSlotIdx);
const cleaningSlot = code.substring(cleaningSlotIdx, propCalIdx);
const propCal = code.substring(propCalIdx, legendsIdx);
const legends = code.substring(legendsIdx, mainPageIdx);
const mainPage = code.substring(mainPageIdx);

fs.mkdirSync('client/src/components/calendar', { recursive: true });

fs.writeFileSync('client/src/components/calendar/constants.ts', `
${consts.trim()}
export { CHANNEL_COLORS, CHANNEL_LABELS, CLEANING_COLORS, BOOKING_INFO_COLORS };
`);

function createComponentFile(content) {
  return `${mainImports}
import { CHANNEL_COLORS, CHANNEL_LABELS, CLEANING_COLORS, BOOKING_INFO_COLORS } from "./constants";
${content.trim()}
`;
}

fs.writeFileSync('client/src/components/calendar/CleaningTableView.tsx', createComponentFile(cleaningTable) + '\nexport { CleaningDateCell, CleaningTableView };\n');
fs.writeFileSync('client/src/components/calendar/CleaningSlotModal.tsx', createComponentFile(cleaningSlot) + '\nexport { CleaningSlotModal };\n');
fs.writeFileSync('client/src/components/calendar/PropertyCalendar.tsx', createComponentFile(propCal) + '\nexport { PropertyCalendar };\n');
fs.writeFileSync('client/src/components/calendar/Legends.tsx', createComponentFile(legends) + '\nexport { BookingLegend, CleaningLegend };\n');

fs.writeFileSync('client/src/pages/CalendarView.tsx', `${mainImports}
import { BookingLegend, CleaningLegend } from "@/components/calendar/Legends";
import { PropertyCalendar } from "@/components/calendar/PropertyCalendar";
import { CleaningSlotModal } from "@/components/calendar/CleaningSlotModal";
import { CleaningTableView } from "@/components/calendar/CleaningTableView";

${mainPage.trim()}
`);

console.log("Decomposition successful!");