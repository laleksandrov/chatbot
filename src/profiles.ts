export const assistantProfiles = [
  "public_pre_registration",
  "registered_customer",
  "accounting_client",
] as const;

export type AssistantProfile = (typeof assistantProfiles)[number];

export interface AssistantProfilePolicy {
  profile: AssistantProfile;
  maxMessageCharacters: number;
  messagesPerWindow: number;
  quotaWindowSeconds: number;
  retentionDays: number;
  requiresOrganization: boolean;
  allowsTenantDocuments: boolean;
  allowsOrganizationDocuments: boolean;
  allowsHumanEscalation: boolean;
  instructions: string;
}

export const assistantProfilePolicies: Record<AssistantProfile, AssistantProfilePolicy> = {
  public_pre_registration: {
    profile: "public_pre_registration",
    maxMessageCharacters: 2_000,
    messagesPerWindow: 10,
    quotaWindowSeconds: 24 * 60 * 60,
    retentionDays: 30,
    requiresOrganization: false,
    allowsTenantDocuments: false,
    allowsOrganizationDocuments: false,
    allowsHumanEscalation: false,
    instructions: [
      "Потребителят още не е регистриран.",
      "Отговаряй само на общи въпроси за платформата и обща ориентация по бизнес, данъчни, счетоводни и осигурителни теми.",
      "Не анализирай конкретни документи, индивидуални факти или чувствителни казуси.",
      "Когато е необходим персонализиран отговор, обясни кратко, че е нужна регистрация.",
      "Човешка ескалация и клиентски данни не са достъпни в този режим.",
    ].join(" "),
  },
  registered_customer: {
    profile: "registered_customer",
    maxMessageCharacters: 5_000,
    messagesPerWindow: 50,
    quotaWindowSeconds: 24 * 60 * 60,
    retentionDays: 180,
    requiresOrganization: false,
    allowsTenantDocuments: true,
    allowsOrganizationDocuments: false,
    allowsHumanEscalation: false,
    instructions: [
      "Потребителят е регистриран в платформата, но не е удостоверен като клиент на счетоводната фирма.",
      "Може да получава по-подробна обща помощ и tenant-level знания на платформата.",
      "Не използвай документи на конкретна счетоводна организация и не твърди, че казусът е прегледан от счетоводител.",
      "При високорисков индивидуален казус посочи, че е необходим експертен преглед.",
    ].join(" "),
  },
  accounting_client: {
    profile: "accounting_client",
    maxMessageCharacters: 10_000,
    messagesPerWindow: 200,
    quotaWindowSeconds: 24 * 60 * 60,
    retentionDays: 365,
    requiresOrganization: true,
    allowsTenantDocuments: false,
    allowsOrganizationDocuments: true,
    allowsHumanEscalation: true,
    instructions: [
      "Потребителят е удостоверен клиент на счетоводната фирма.",
      "Използвай глобалните източници и документите, изрично свързани с неговата организация.",
      "Не използвай и не разкривай данни на друга организация.",
      "При недостатъчни доказателства или високорисков конкретен казус използвай human_escalation към EMS.",
      "Не искай ЕГН, пароли, банкови данни или други ненужни чувствителни данни в чата.",
    ].join(" "),
  },
};

export function profilePolicy(profile: AssistantProfile): AssistantProfilePolicy {
  return assistantProfilePolicies[profile];
}
