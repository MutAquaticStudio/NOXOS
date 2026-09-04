import { describe, expect, it } from "vitest";
import {
  createContactSchema,
  createCustomerSchema,
  createInteractionSchema,
  createServiceOrderSchema,
  replaceServiceOrderLinesSchema
} from "@nox-os/lab-services";

const customerId = "10000000-0000-4000-8000-000000000001";

describe("Gate 11 Lab Services contracts", () => {
  it("accepts the exact Customer types/status-free create contract", () => {
    expect(
      createCustomerSchema.parse({
        customerCode: "LAB-001",
        customerType: "BUSINESS",
        displayName: "Atelier One",
        legalName: null,
        taxIdentifier: null,
        countryCode: "VN",
        notes: null
      })
    ).toMatchObject({ customerCode: "LAB-001", customerType: "BUSINESS" });
    expect(
      createCustomerSchema.safeParse({
        customerCode: "lab 001",
        customerType: "OPPORTUNITY",
        displayName: "Invalid"
      }).success
    ).toBe(false);
  });

  it("allows a PROSPECT-compatible DRAFT with zero lines but validates canonical line scope", () => {
    expect(
      createServiceOrderSchema.parse({
        orderNumber: "LSO-001",
        customerId,
        customerContactId: null,
        customerExternalReference: null,
        intakeSummary: "Evaluate an R&D service scope.",
        requestedCompletionDate: null,
        notes: null
      }).lines
    ).toEqual([]);
    expect(
      replaceServiceOrderLinesSchema.safeParse({
        lines: [
          {
            lineOrder: 1,
            serviceType: "FORMULATION_RND",
            title: "Formulation study",
            scopeDescription: "Customer-facing laboratory research scope.",
            notes: null
          }
        ]
      }).success
    ).toBe(true);
    expect(
      replaceServiceOrderLinesSchema.safeParse({
        lines: [
          {
            lineOrder: 0,
            serviceType: "COMMERCIAL_ORDER",
            title: "No",
            scopeDescription: "No"
          }
        ]
      }).success
    ).toBe(false);
  });

  it("keeps Contacts and Interactions bounded and rejects arbitrary authority fields", () => {
    expect(
      createContactSchema.safeParse({
        fullName: "Lab Contact",
        email: "lab@example.test",
        isPrimary: true
      }).success
    ).toBe(true);
    expect(
      createInteractionSchema.safeParse({
        serviceOrderId: null,
        interactionType: "MEETING",
        occurredAt: new Date().toISOString(),
        summary: "Reviewed requested laboratory scope.",
        nextActionText: null,
        nextActionDate: null
      }).success
    ).toBe(true);
    expect(
      createInteractionSchema.safeParse({
        serviceOrderId: null,
        interactionType: "MEETING",
        occurredAt: new Date().toISOString(),
        summary: "Forged",
        tenantId: customerId,
        createdByUserId: customerId
      }).success
    ).toBe(false);
  });
});
