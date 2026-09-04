import { z } from "zod";

export const labUuidSchema = z.string().uuid();
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => requiredText(max).nullable().optional();
const optionalTimestamp = z.string().datetime({ offset: true }).nullable().optional();

export const customerTypeSchema = z.enum(["INDIVIDUAL", "BUSINESS"]);
export const customerStatusSchema = z.enum(["PROSPECT", "ACTIVE", "ON_HOLD", "ARCHIVED"]);
export const contactStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const serviceOrderStatusSchema = z.enum([
  "DRAFT",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED"
]);
export const serviceTypeSchema = z.enum([
  "FORMULATION_RND",
  "TRIAL_EVALUATION",
  "TECHNICAL_CONSULTING",
  "PRODUCTION_SUPPORT",
  "OTHER"
]);
export const interactionTypeSchema = z.enum(["EMAIL", "CALL", "MEETING", "NOTE", "OTHER"]);

export const serviceOrderLineInputSchema = z
  .object({
    lineOrder: z.number().int().positive(),
    serviceType: serviceTypeSchema,
    title: requiredText(200),
    scopeDescription: requiredText(4000),
    notes: optionalText(4000)
  })
  .strict();

export const createCustomerSchema = z
  .object({
    customerCode: requiredText(80).regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/),
    customerType: customerTypeSchema,
    displayName: requiredText(200),
    legalName: optionalText(240),
    taxIdentifier: optionalText(120),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    notes: optionalText(4000)
  })
  .strict();

export const updateCustomerSchema = createCustomerSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one Customer field is required.");

export const createContactSchema = z
  .object({
    fullName: requiredText(200),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: optionalText(80),
    roleTitle: optionalText(160),
    isPrimary: z.boolean().optional().default(false)
  })
  .strict();

export const updateContactSchema = createContactSchema
  .omit({ isPrimary: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one Contact field is required.");

export const createServiceOrderSchema = z
  .object({
    orderNumber: requiredText(80).regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/),
    customerId: labUuidSchema,
    customerContactId: labUuidSchema.nullable().optional(),
    customerExternalReference: optionalText(240),
    intakeSummary: requiredText(4000),
    requestedCompletionDate: optionalTimestamp,
    notes: optionalText(4000),
    lines: z.array(serviceOrderLineInputSchema).max(100).optional().default([])
  })
  .strict();

export const updateServiceOrderSchema = z
  .object({
    customerId: labUuidSchema.optional(),
    customerContactId: labUuidSchema.nullable().optional(),
    customerExternalReference: optionalText(240),
    intakeSummary: requiredText(4000).optional(),
    requestedCompletionDate: optionalTimestamp,
    notes: optionalText(4000)
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one Service Order field is required."
  );

export const replaceServiceOrderLinesSchema = z
  .object({ lines: z.array(serviceOrderLineInputSchema).max(100) })
  .strict();

export const cancelServiceOrderSchema = z
  .object({ reason: requiredText(2000).nullable().optional() })
  .strict();

export const createInteractionSchema = z
  .object({
    serviceOrderId: labUuidSchema.nullable().optional(),
    interactionType: interactionTypeSchema,
    occurredAt: z.string().datetime({ offset: true }),
    summary: requiredText(4000),
    nextActionText: optionalText(1000),
    nextActionDate: optionalTimestamp
  })
  .strict();

export type CustomerType = z.infer<typeof customerTypeSchema>;
export type CustomerStatus = z.infer<typeof customerStatusSchema>;
export type ContactStatus = z.infer<typeof contactStatusSchema>;
export type ServiceOrderStatus = z.infer<typeof serviceOrderStatusSchema>;
export type ServiceType = z.infer<typeof serviceTypeSchema>;
export type InteractionType = z.infer<typeof interactionTypeSchema>;
export type ServiceOrderLineInput = z.infer<typeof serviceOrderLineInputSchema>;
export type CreateCustomerRequest = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerRequest = z.infer<typeof updateCustomerSchema>;
export type CreateContactRequest = z.infer<typeof createContactSchema>;
export type UpdateContactRequest = z.infer<typeof updateContactSchema>;
export type CreateServiceOrderRequest = z.infer<typeof createServiceOrderSchema>;
export type UpdateServiceOrderRequest = z.infer<typeof updateServiceOrderSchema>;
export type CreateInteractionRequest = z.infer<typeof createInteractionSchema>;

export type LabServicesCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};

export type Customer = {
  id: string;
  tenantId: string;
  customerCode: string;
  customerType: CustomerType;
  displayName: string;
  legalName: string | null;
  taxIdentifier: string | null;
  countryCode: string | null;
  status: CustomerStatus;
  notes: string | null;
  createdByUserId: string;
  heldByUserId: string | null;
  archivedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  heldAt: Date | null;
  archivedAt: Date | null;
};

export type CustomerRegistryEntry = Customer & {
  primaryContactName: string | null;
  openServiceOrderCount: number;
  lastInteractionAt: Date | null;
};

export type CustomerContact = {
  id: string;
  tenantId: string;
  customerId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  status: ContactStatus;
  isPrimary: boolean;
  createdByUserId: string;
  archivedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type ServiceOrderLine = ServiceOrderLineInput & {
  id: string;
  tenantId: string;
  serviceOrderId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ServiceOrder = {
  id: string;
  tenantId: string;
  orderNumber: string;
  customerId: string;
  customerCode: string;
  customerDisplayName: string;
  customerContactId: string | null;
  contactFullName: string | null;
  customerExternalReference: string | null;
  intakeSummary: string;
  requestedCompletionDate: Date | null;
  status: ServiceOrderStatus;
  notes: string | null;
  cancellationReason: string | null;
  createdByUserId: string;
  confirmedByUserId: string | null;
  startedByUserId: string | null;
  completedByUserId: string | null;
  cancelledByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lines: readonly ServiceOrderLine[];
};

export type CustomerInteraction = {
  id: string;
  tenantId: string;
  customerId: string;
  serviceOrderId: string | null;
  interactionType: InteractionType;
  occurredAt: Date;
  summary: string;
  nextActionText: string | null;
  nextActionDate: Date | null;
  createdByUserId: string;
  createdAt: Date;
};

export type LabServiceOrderProjection = {
  serviceOrderId: string;
  orderNumber: string;
  status: ServiceOrderStatus;
  customerId: string;
  customerCode: string;
  customerDisplayName: string;
  pinnedContact: {
    contactId: string;
    fullName: string;
    email: string | null;
    phone: string | null;
  } | null;
  intakeSummary: string;
  requestedCompletionDate: Date | null;
  lines: readonly Pick<
    ServiceOrderLine,
    "id" | "lineOrder" | "serviceType" | "title" | "scopeDescription"
  >[];
};

export type CustomerDirectoryProjection = {
  customerId: string;
  customerCode: string;
  customerType: CustomerType;
  displayName: string;
  legalName: string | null;
  taxIdentifier: string | null;
  countryCode: string | null;
  status: CustomerStatus;
  primaryContact: Pick<CustomerContact, "id" | "fullName" | "email" | "phone" | "roleTitle"> | null;
};
