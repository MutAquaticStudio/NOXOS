import type { ActorContext, TenantContext } from "@nox-os/contracts";

export interface TenantResolver {
  resolve(actor: ActorContext | undefined): Promise<TenantContext | undefined>;
}

export interface AuthorizationPort {
  canAccess(
    actor: ActorContext | undefined,
    tenant: TenantContext | undefined,
    permission: string
  ): Promise<boolean>;
}

export const denyByDefaultAuthorization: AuthorizationPort = {
  async canAccess(): Promise<boolean> {
    return false;
  }
};
