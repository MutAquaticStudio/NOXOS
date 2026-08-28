import type { ActorContext, RequestContext } from "@nox-os/contracts";

export interface AuthenticationPort {
  authenticate(context: RequestContext): Promise<ActorContext | undefined>;
}

export const unauthenticated: AuthenticationPort = {
  async authenticate(): Promise<ActorContext | undefined> {
    return undefined;
  }
};
