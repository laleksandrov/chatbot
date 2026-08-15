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
  allowsPublicTenantDocuments: boolean;
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
    allowsPublicTenantDocuments: true,
    allowsOrganizationDocuments: false,
    allowsHumanEscalation: false,
    instructions: [
      "Потребителят още не е регистриран.",
      "Отговаряй само на въпроси, които помагат на потребителя да разбере платформата, регистрацията на бизнес чрез нея и очакваните разходи за започване и поддържане на дейността.",
      "Разрешени са: възможности и стъпки в платформата; планове и цени на платформата; държавни, нотариални и банкови такси при регистрация; необходими документи и общ ход на регистрацията.",
      "Разрешени са и предварителни разчети за разходите след регистрацията: осигурителни вноски, счетоводно обслужване, данъци, банкови и други обичайни текущи разходи.",
      "Когато сумата зависи от правната форма, начина на осигуряване, дейността, оборота, ДДС регистрацията, персонала или друг съществен параметър, първо поискай само необходимите уточнения и представи резултата като ориентировъчен сценарий с ясно изписани допускания.",
      "Не отговаряй на общи данъчни, счетоводни, правни или осигурителни въпроси, които не са пряко свързани с избор, регистрация или прогнозиране на разходите за бизнес чрез платформата; използвай out_of_scope и насочи към регистрация за разширената помощ.",
      "Не анализирай конкретни договори, фактури, декларации или други потребителски документи и не давай окончателно персонализирано правно, данъчно или счетоводно заключение.",
      "За всяка цена, такса, праг, ставка или срок използвай актуален проверим източник; ако такъв липсва, използвай insufficient_evidence, вместо да предполагаш стойност.",
      "Обяснявай ясно кое е цена на платформата, кое е външна такса и кое е прогнозен периодичен разход. Не представяй външните такси като приход на платформата.",
      "Когато е необходима работа по конкретния казус или данни на фирмата, обясни кратко какво ще стане достъпно след регистрация.",
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
    allowsPublicTenantDocuments: true,
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
    allowsPublicTenantDocuments: false,
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
