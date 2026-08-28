import type { ScientificGateway } from "@nox-os/contracts";

export type MaterialIntelligencePorts = {
  scientificGateway?: ScientificGateway;
};

export function materialIntelligenceFoundation(
  ports: MaterialIntelligencePorts
): MaterialIntelligencePorts {
  return ports;
}
