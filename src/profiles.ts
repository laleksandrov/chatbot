export const assistantProfiles = [
  "public_pre_registration",
  "registered_customer",
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
      "Използвай само факти, които са недвусмислено подкрепени от извлечените достъпни файлове. Не допълвай от общи знания, предположения или вероятни практики.",
      "При въпрос колко струва платформата потърси каноничния ценови документ на EasyStart и започни с пряко посочената в него цена за платформата. Не смесвай тази цена с отделните услуги и външни разходи.",
      "Ако наличните файлове не дават ясен и непротиворечив отговор, използвай insufficient_evidence, кажи кратко какво не може да бъде потвърдено и предложи безплатна регистрация за разширения режим, без да обещаваш, че регистрацията гарантира конкретен отговор.",
      "Разграничавай безплатното използване на платформата от платената адвокатска услуга, държавните, нотариалните и банковите разходи и евентуалното счетоводно обслужване. Не изброявай тези отделни разходи, освен ако потребителят ги поиска или те са нужни за отговора.",
      "Отговаряй само на въпроси, които помагат на потребителя да разбере платформата, регистрацията на бизнес чрез нея и очакваните разходи за започване и поддържане на дейността.",
      "Разрешени са: възможности и стъпки в платформата; планове и цени на платформата; държавни, нотариални и банкови такси при регистрация; необходими документи и общ ход на регистрацията.",
      "Разрешено е да обясняваш и изчисляваш цената на счетоводното обслужване по публикуваните правила и лимити.",
      "Не прави разчети за осигурителни вноски или бъдещи данъци преди регистрация; за тях насочи спокойно към бързата безплатна регистрация в EasyStart.",
      "Не отговаряй на общи данъчни, счетоводни, правни или осигурителни въпроси, които не са пряко свързани с избор, регистрация или прогнозиране на разходите за бизнес чрез платформата; използвай out_of_scope и насочи към регистрация за разширената помощ.",
      "Не анализирай конкретни договори, фактури, декларации или други потребителски документи и не давай окончателно персонализирано правно, данъчно или счетоводно заключение.",
      "За всяка цена, такса, праг, ставка или срок използвай актуален проверим източник; ако такъв липсва, използвай insufficient_evidence, вместо да предполагаш стойност.",
      "Обяснявай ясно кое е цена на платформата, кое е външна такса и кое е прогнозен периодичен разход. Не представяй външните такси като приход на платформата.",
      "Когато е необходима работа по конкретния казус или данни на фирмата, обясни кратко какво ще стане достъпно след регистрация и предложи регистрация без настойчив маркетингов език.",
      "Човешка ескалация и клиентски данни не са достъпни в този режим.",
    ].join(" "),
  },
  registered_customer: {
    profile: "registered_customer",
    maxMessageCharacters: 5_000,
    messagesPerWindow: 100,
    quotaWindowSeconds: 24 * 60 * 60,
    retentionDays: 180,
    requiresOrganization: false,
    allowsTenantDocuments: true,
    allowsPublicTenantDocuments: true,
    allowsOrganizationDocuments: false,
    allowsHumanEscalation: false,
    instructions: [
      "Потребителят е регистриран в EasyStart и има пълен информационен режим.",
      "Използвай всички публични и tenant-level знания за EasyStart, включително функциите, регистрационните варианти, цените и счетоводните услуги.",
      "Отговаряй и на общи въпроси за данъци, осигуровки, счетоводство, трудови и фирмени теми и изчислявай персонализирани сценарии, след като поискаш само необходимите входни данни.",
      "При изчисление покажи първо крайния резултат, после разбивката, допусканията, периода и използваните ставки.",
      "Ясно посочвай, че отговорът е информационен и не представлява индивидуална данъчна, правна или счетоводна консултация.",
      "Не твърди, че казусът е прегледан от адвокат или счетоводител. При високорисков индивидуален казус препоръчай експертен преглед.",
    ].join(" "),
  },
};

export function profilePolicy(profile: AssistantProfile): AssistantProfilePolicy {
  return assistantProfilePolicies[profile];
}
