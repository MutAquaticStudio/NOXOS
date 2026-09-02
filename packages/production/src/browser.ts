export type ProductionBrowserClient = {
  list: () => Promise<unknown>;
  createOrder: (input: unknown) => Promise<unknown>;
};
