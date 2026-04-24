import { describe, it, expect, vi } from "vitest";
import { PdfGeneratorService } from "../services/PdfGeneratorService";
import fs from "fs";

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(Buffer.from("dummy-font")),
  }
}));

vi.mock("jspdf", () => {
  return {
    jsPDF: vi.fn().mockImplementation(() => ({
      addFileToVFS: vi.fn(),
      addFont: vi.fn(),
      setFont: vi.fn(),
      setFontSize: vi.fn(),
      splitTextToSize: vi.fn().mockReturnValue(["line1", "line2"]),
      text: vi.fn(),
      addPage: vi.fn(),
      output: vi.fn().mockReturnValue(new ArrayBuffer(8)),
    })),
  };
});

describe("PdfGeneratorService", () => {
  const mockBooking: any = {
    property: "Sadoles",
    checkIn: new Date(),
    checkOut: new Date(),
    createdAt: new Date(),
    guestName: "Zażółć gęślą jaźń", // Special characters
    totalPrice: "1000",
    purpose: "leisure",
  };

  it("generates PDF without crashing with special characters", async () => {
    const buffer = await PdfGeneratorService.generateContractPDF(mockBooking, "PL");
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });
});
