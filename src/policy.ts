/**
 * Entitlements and permissible-use policy for third-party agents.
 *
 * Every tool call is authorized against three questions:
 *   1. Is this agent allowed to call this tool at all?
 *   2. Is the stated purpose one this agent is permitted to use data for?
 *   3. Is the client (data subject) inside this agent's scope?
 * Default is deny. Every decision carries a reason so it can be traced.
 */
export const PURPOSES = ["engagement_support", "quality_review", "analytics", "audit_export"] as const;
export type Purpose = (typeof PURPOSES)[number];

export interface AgentGrant {
  agentId: string;
  vendor: string;
  tools: string[];
  purposes: Purpose[];
  /** Client IDs this agent may touch, or "*" for all. */
  clientScopes: string[] | "*";
}

export interface Decision {
  allowed: boolean;
  reason: string;
}

export interface AccessRequest {
  agentId: string;
  tool: string;
  purpose: Purpose;
  clientId?: string;
}

export function authorize(policy: readonly AgentGrant[], req: AccessRequest): Decision {
  const grant = policy.find((g) => g.agentId === req.agentId);
  if (!grant) return { allowed: false, reason: `unknown agent '${req.agentId}'` };
  if (!grant.tools.includes(req.tool)) {
    return { allowed: false, reason: `tool '${req.tool}' not granted to ${grant.agentId}` };
  }
  if (!grant.purposes.includes(req.purpose)) {
    return { allowed: false, reason: `purpose '${req.purpose}' not permitted for ${grant.agentId}` };
  }
  if (req.clientId !== undefined && grant.clientScopes !== "*" && !grant.clientScopes.includes(req.clientId)) {
    return { allowed: false, reason: `client '${req.clientId}' outside scope of ${grant.agentId}` };
  }
  return { allowed: true, reason: "granted" };
}

export function vendorOf(policy: readonly AgentGrant[], agentId: string): string {
  return policy.find((g) => g.agentId === agentId)?.vendor ?? "unknown";
}

/** Example policy. In production this would come from an entitlement service, not code. */
export const examplePolicy: AgentGrant[] = [
  {
    agentId: "acme-assurance-agent",
    vendor: "acme-ai",
    tools: ["get_engagement", "record_finding"],
    purposes: ["engagement_support", "quality_review"],
    clientScopes: ["client-001", "client-002"],
  },
  {
    agentId: "insights-agent",
    vendor: "insightco",
    tools: ["get_engagement"],
    purposes: ["analytics"],
    clientScopes: "*",
  },
  {
    agentId: "platform-auditor",
    vendor: "internal",
    tools: ["export_decision_traces", "verify_decision_traces"],
    purposes: ["audit_export"],
    clientScopes: "*",
  },
];
