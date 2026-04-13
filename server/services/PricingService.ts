import { format } from "date-fns";
import { BookingRepository } from "../repositories/BookingRepository";
import { PropertyRepository } from "../repositories/PropertyRepository";
import { type Property } from "@shared/config";

export interface PricingResult {
  valid: boolean;
  error?: string;
  days: number;
  totalPrice: number;
  basePrice?: number;
  discountAmount?: number;
  appliedDiscounts?: {
    duration: number;
    lastMinute: boolean;
  };
  petFee?: number;
  currency: string;
}

export class PricingService {
  /**
   * Calculates the price for a booking based on dates, property, and guest counts.
   * Includes availability checks and discount logic.
   */
  static async calculatePrice(params: {
    property: Property;
    checkIn: Date;
    checkOut: Date;
    guestCount: number;
    animalsCount: number;
  }): Promise<PricingResult> {
    const { property, checkIn, checkOut, guestCount, animalsCount } = params;

    // 4 PM is the standard check-in time, 10 AM is the standard check-out time.
    // If check-in is earlier than 4 PM, add one day to the calculation.
    // If check-out is later than 10 AM, add one day to the calculation.
    const isEarlyCheckIn = checkIn.getHours() < 16;
    const isLateCheckOut = checkOut.getHours() > 10 || (checkOut.getHours() === 10 && checkOut.getMinutes() > 0);

    const baseDays = Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
    let pricingDays = baseDays;
    if (isEarlyCheckIn) pricingDays += 1;
    if (isLateCheckOut) pricingDays += 1;

    if (pricingDays <= 0) throw new Error("Check-out must be after check-in");

    // Fetch dynamic settings
    const settings = await PropertyRepository.getPropertySettings(property);
    if (!settings) throw new Error("Property settings not found");

    // Check availability (double booking prevention)
    const overlapping = await BookingRepository.findOverlapCandidates(property, checkIn, checkOut);

    // Filter out same-day turnover cases that HAVE enough gap (>= 6h)
    const actualConflicts = overlapping.filter(b => {
      const bIn = new Date(b.checkIn);
      const bOut = new Date(b.checkOut);
      
      if (format(checkOut, "yyyy-MM-dd") === format(bIn, "yyyy-MM-dd")) {
        const gap = bIn.getTime() - checkOut.getTime();
        if (gap >= 6 * 60 * 60 * 1000) return false;
      }
      
      if (format(checkIn, "yyyy-MM-dd") === format(bOut, "yyyy-MM-dd")) {
        const gap = checkIn.getTime() - bOut.getTime();
        if (gap >= 6 * 60 * 60 * 1000) return false;
      }
      
      return true;
    });

    if (actualConflicts.length > 0) {
      return {
        valid: false,
        error: "Selected dates are no longer available",
        days: pricingDays,
        totalPrice: 0,
        currency: "PLN"
      };
    }

    let effectiveCheckIn = new Date(checkIn);
    if (isEarlyCheckIn) effectiveCheckIn.setDate(effectiveCheckIn.getDate() - 1);
    
    let effectiveCheckOut = new Date(checkOut);
    if (isLateCheckOut) effectiveCheckOut.setDate(effectiveCheckOut.getDate() + 1);

    const effectiveCheckInStr = format(effectiveCheckIn, "yyyy-MM-dd");
    const effectiveCheckOutStr = format(effectiveCheckOut, "yyyy-MM-dd");

    const nights = await PropertyRepository.findNightsPricing(property, effectiveCheckInStr, effectiveCheckOutStr);

    if (nights.length < pricingDays) {
      throw new Error(`Pricing data missing for selected dates (requested ${pricingDays}, found ${nights.length})`);
    }

    // Check min stay
    const violatedMinStay = nights.find(n => pricingDays < n.minStay);
    if (violatedMinStay) {
      return {
        valid: false,
        error: `Minimum stay for this period is ${violatedMinStay.minStay} nights`,
        days: pricingDays,
        totalPrice: 0,
        currency: "PLN"
      };
    }

    // Apply guest count multiplier
    let multiplier = 1.0;
    if (settings.peopleDiscount) {
      const discounts = (typeof settings.peopleDiscount === 'string' 
        ? JSON.parse(settings.peopleDiscount) 
        : settings.peopleDiscount) as Array<{ maxGuests: number, multiplier: number }>;
      
      const match = [...discounts].sort((a, b) => a.maxGuests - b.maxGuests).find(d => guestCount <= d.maxGuests);
      if (match) multiplier = match.multiplier;
    }

    const nightlySumBase = nights.reduce((sum, n) => sum + n.nightlyPrice * multiplier, 0);

    // Duration discounts
    let durationDiscount = 0;
    if (settings.stayDurationDiscounts) {
      const discounts = (typeof settings.stayDurationDiscounts === 'string'
        ? JSON.parse(settings.stayDurationDiscounts)
        : settings.stayDurationDiscounts) as Array<{ minNights: number, discount: number }>;
      
      const match = [...discounts].sort((a, b) => b.minNights - a.minNights).find(d => pricingDays >= d.minNights);
      if (match) durationDiscount = match.discount;
    }

    // Last minute discount
    const now = new Date();
    const diffMs = checkIn.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    let lastMinuteDiscountApplied = 0;
    if (diffDays >= 0 && diffDays <= settings.lastMinuteDays) {
      lastMinuteDiscountApplied = parseFloat(String(settings.lastMinuteDiscount));
    }

    const totalDiscountMultiplier = durationDiscount + lastMinuteDiscountApplied;
    const discountAmount = Math.round(nightlySumBase * totalDiscountMultiplier);
    const nightlySum = nightlySumBase - discountAmount;
    
    const fixedFee = settings.fixedBookingPrice;
    const petFee = animalsCount * settings.petFee;
    
    const totalPrice = Math.round((fixedFee + nightlySum + petFee) / 10) * 10;
    const basePriceNoDiscounts = Math.round((fixedFee + nightlySumBase + petFee) / 10) * 10;

    return {
      valid: true,
      days: pricingDays,
      totalPrice,
      basePrice: basePriceNoDiscounts,
      discountAmount: basePriceNoDiscounts - totalPrice,
      appliedDiscounts: {
        duration: durationDiscount,
        lastMinute: lastMinuteDiscountApplied > 0
      },
      petFee,
      currency: "PLN"
    };
  }
}
