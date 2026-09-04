import type { CommercialAnalyticsSource, CommercialCommandContext } from "./contracts.js";
export interface CommercialOrdersStore extends CommercialAnalyticsSource {
  listQuotes(tenantId: string): Promise<unknown[]>;
  findQuote(tenantId: string, quoteId: string): Promise<unknown | undefined>;
  createQuote(input: CommercialCommandContext & Record<string, unknown>): Promise<unknown>;
  updateQuote(
    input: CommercialCommandContext & { quoteId: string; changes: Record<string, unknown> }
  ): Promise<unknown>;
  issueQuote(input: CommercialCommandContext & { quoteId: string }): Promise<unknown>;
  reviseQuote(
    input: CommercialCommandContext & { quoteId: string; quoteNumber: string }
  ): Promise<unknown>;
  acceptQuote(input: CommercialCommandContext & { quoteId: string }): Promise<unknown>;
  declineQuote(input: CommercialCommandContext & { quoteId: string }): Promise<unknown>;
  cancelQuote(
    input: CommercialCommandContext & { quoteId: string; reason?: string }
  ): Promise<unknown>;
  createOrderFromQuote(
    input: CommercialCommandContext & { quoteId: string; orderNumber: string }
  ): Promise<unknown>;
  listOrders(tenantId: string): Promise<unknown[]>;
  findOrder(tenantId: string, orderId: string): Promise<unknown | undefined>;
  createOrder(input: CommercialCommandContext & Record<string, unknown>): Promise<unknown>;
  updateOrder(
    input: CommercialCommandContext & { orderId: string; changes: Record<string, unknown> }
  ): Promise<unknown>;
  confirmOrder(input: CommercialCommandContext & { orderId: string }): Promise<unknown>;
  cancelOrder(
    input: CommercialCommandContext & { orderId: string; reason: string }
  ): Promise<unknown>;
  closeOrder(input: CommercialCommandContext & { orderId: string }): Promise<unknown>;
  listAllocations(tenantId: string, orderId: string): Promise<unknown[]>;
  createAllocation(input: CommercialCommandContext & Record<string, unknown>): Promise<unknown>;
  releaseAllocation(input: CommercialCommandContext & { allocationId: string }): Promise<unknown>;
  listFulfillments(tenantId: string, orderId: string): Promise<unknown[]>;
  createFulfillment(
    input: CommercialCommandContext & {
      orderId: string;
      fulfillmentNumber: string;
      notes?: string | null;
    }
  ): Promise<unknown>;
  findFulfillment(tenantId: string, fulfillmentId: string): Promise<unknown | undefined>;
  updateFulfillment(
    input: CommercialCommandContext & { fulfillmentId: string; notes?: string | null }
  ): Promise<unknown>;
  replaceFulfillmentLines(
    input: CommercialCommandContext & {
      fulfillmentId: string;
      lines: readonly Record<string, unknown>[];
    }
  ): Promise<unknown[]>;
  confirmFulfillment(input: CommercialCommandContext & { fulfillmentId: string }): Promise<unknown>;
  cancelFulfillment(
    input: CommercialCommandContext & { fulfillmentId: string; reason?: string }
  ): Promise<unknown>;
  createShipment(
    input: CommercialCommandContext & { fulfillmentId: string } & Record<string, unknown>
  ): Promise<unknown>;
  findShipment(tenantId: string, shipmentId: string): Promise<unknown | undefined>;
  updateShipment(
    input: CommercialCommandContext & { shipmentId: string; changes: Record<string, unknown> }
  ): Promise<unknown>;
  shipShipment(input: CommercialCommandContext & { shipmentId: string }): Promise<unknown>;
  deliverShipment(input: CommercialCommandContext & { shipmentId: string }): Promise<unknown>;
  cancelShipment(
    input: CommercialCommandContext & { shipmentId: string; reason: string }
  ): Promise<unknown>;
}
