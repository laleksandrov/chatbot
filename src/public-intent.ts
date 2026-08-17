export type PublicIntentGroup =
  | "platform_capabilities"
  | "platform_pricing"
  | "platform_mixed"
  | "external_registration_costs"
  | "restricted"
  | "unknown";

export interface PublicIntentDecision {
  group: PublicIntentGroup;
  includeOfficialSources: boolean;
}

function normalized(message: string): string {
  return message
    .toLocaleLowerCase("bg-BG")
    .replaceAll(/[\p{P}\p{S}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

const calculationPatterns = [/колко/u, /изчисл/u, /сметн/u, /дълж/u, /плащ/u];
const specificCasePatterns = [
  /конкрет/u,
  /тази/u,
  /този/u,
  /моя/u,
  /сделк/u,
  /фактур/u,
  /договор/u,
  /декларац/u,
  /казус/u,
];
const regulatedTopicPatterns = [/дан(?:ък|ъц|ъчн)/u, /осигур/u, /осчетовод/u, /правен/u, /правна/u];
const platformPatterns = [/easystart/u, /easy\s*start/u, /изистарт/u, /платформ/u, /сайт/u];
const conversationalPlatformPatterns = [
  /тук/u,
  /при\s+вас/u,
  /предлаг/u,
  /помог/u,
  /включ/u,
  /имате/u,
];
const capabilityQuestionPatterns = [
  /какв/u,
  /кои/u,
  /как/u,
  /мож/u,
  /имате/u,
  /предлаг/u,
  /помог/u,
  /прав/u,
  /работи/u,
  /функц/u,
  /възможност/u,
  /управля/u,
  /собствен/u,
];
const registrationPatterns = [/регистрац/u, /учред/u, /еоод/u, /оод/u, /дружеств/u, /нова?\s+фирм/u];
const registrationProcessPatterns = [
  /документ/u,
  /генерир/u,
  /подад/u,
  /кеп/u,
  /електронен\s+подпис/u,
  /гише/u,
  /адвокат/u,
  /срок/u,
  /статус/u,
  /прослед/u,
  /указан/u,
  /отказ/u,
  /гаранц/u,
  /колко\s+време/u,
  /отнем/u,
];
const companyChangePatterns = [
  /смен/u,
  /промен/u,
  /управител/u,
  /адрес/u,
  /наименован/u,
  /съдруж/u,
  /дял/u,
  /предмет\s+на\s+дейност/u,
  /капитал/u,
  /преобразув/u,
];
const publicationPatterns = [
  /г\s*[23]/u,
  /гфо/u,
  /годиш(?:ен|ния)\s+финансов/u,
  /публикув/u,
  /обявяв/u,
];
const foreignAccessPatterns = [
  /чужден/u,
  /чужбина/u,
  /извън\s+българия/u,
  /нерезидент/u,
  /не\s+съм\s+българ/u,
  /българск(?:и|о)\s+(?:граждан|език)/u,
  /само\s+в\s+българия/u,
];
const accessModePatterns = [
  /преди\s+регистрац/u,
  /след\s+регистрац/u,
  /без\s+регистрац/u,
  /аноним/u,
  /профил/u,
  /достъп/u,
  /език/u,
  /лимит/u,
  /огранич/u,
  /прекомер/u,
  /премин.*платен/u,
  /платен.*(?:вариант|услуг)/u,
];
const pricePatterns = [
  /цен/u,
  /струв/u,
  /разход/u,
  /такс/u,
  /безплат/u,
  /платен/u,
  /плащ/u,
  /евро/u,
  /депозит/u,
  /неустой/u,
  /предизвест/u,
  /абонамент/u,
  /тариф/u,
  /пакет/u,
  /доплащ/u,
];
const accountingServicePatterns = [
  /счетоводств/u,
  /счетоводно\s+обслужване/u,
  /счетоводна\s+услуга/u,
];
const accountingPricingDetailPatterns = [
  /ддс/u,
  /документ/u,
  /лиц/u,
  /служител/u,
  /включ/u,
  /изключ/u,
  /срок/u,
  /депозит/u,
  /първоначал/u,
  /предизвест/u,
  /неустой/u,
];
const implicitAccountingPricingPatterns = [
  /бро[яи]/u,
  /служител/u,
  /депозит/u,
  /първоначал/u,
  /предизвест/u,
  /неустой/u,
];
const externalFeePatterns = [
  /търговск(?:ия|и)?\s+регист/u,
  /агенци(?:я|ята)\s+по\s+вписван/u,
  /нотари/u,
  /банк/u,
  /електронен\s+подпис/u,
  /кеп/u,
  /държавн(?:а|и)\s+такс/u,
];

export function classifyPublicIntent(message: string): PublicIntentDecision {
  const text = normalized(message);
  const asksForCalculation = matchesAny(text, calculationPatterns);
  const mentionsSpecificCase = matchesAny(text, specificCasePatterns);
  const mentionsContributions = /осигур/u.test(text);
  const mentionsTax = /дан(?:ък|ъц|ъчн)/u.test(text);

  if ((mentionsContributions && asksForCalculation) || (mentionsTax && (asksForCalculation || mentionsSpecificCase))) {
    return { group: "restricted", includeOfficialSources: false };
  }

  const mentionsPlatform = matchesAny(text, platformPatterns);
  const asksAboutCapabilities = matchesAny(text, capabilityQuestionPatterns);
  const conversationalPlatformQuestion = matchesAny(text, conversationalPlatformPatterns);
  const mentionsRegistration = matchesAny(text, registrationPatterns);
  const mentionsRegistrationProcess = matchesAny(text, registrationProcessPatterns);
  const mentionsCompanyChange = matchesAny(text, companyChangePatterns);
  const mentionsPublication = matchesAny(text, publicationPatterns);
  const mentionsForeignAccess = matchesAny(text, foreignAccessPatterns);
  const mentionsAccessMode = matchesAny(text, accessModePatterns);
  const mentionsPrice = matchesAny(text, pricePatterns);
  const mentionsAccountingService = matchesAny(text, accountingServicePatterns);
  const mentionsAccountingPricingDetails = matchesAny(text, accountingPricingDetailPatterns);
  const impliesAccountingPricing = matchesAny(text, implicitAccountingPricingPatterns);
  const mentionsExternalFee = matchesAny(text, externalFeePatterns);

  const capabilityIntent =
    (asksAboutCapabilities &&
      (mentionsPlatform || conversationalPlatformQuestion) &&
      (!mentionsPrice || conversationalPlatformQuestion)) ||
    (mentionsRegistration && asksAboutCapabilities && !mentionsPrice) ||
    (mentionsRegistration && mentionsRegistrationProcess && !mentionsPrice) ||
    (mentionsRegistrationProcess && (!mentionsPrice || asksAboutCapabilities)) ||
    mentionsCompanyChange ||
    mentionsPublication ||
    mentionsForeignAccess ||
    mentionsAccessMode;

  const pricingIntent =
    mentionsPrice ||
    (mentionsAccountingService && mentionsAccountingPricingDetails) ||
    (impliesAccountingPricing && asksAboutCapabilities);

  const needsOfficialSources =
    (mentionsExternalFee && (mentionsPrice || mentionsRegistration)) ||
    (mentionsRegistration && /разход|такс|струв|цен/u.test(text));

  if (needsOfficialSources && !capabilityIntent) {
    return { group: "external_registration_costs", includeOfficialSources: true };
  }
  if (capabilityIntent && pricingIntent) {
    return { group: "platform_mixed", includeOfficialSources: needsOfficialSources };
  }
  if (pricingIntent) {
    return { group: "platform_pricing", includeOfficialSources: needsOfficialSources };
  }
  if (capabilityIntent) {
    return { group: "platform_capabilities", includeOfficialSources: false };
  }
  if (matchesAny(text, regulatedTopicPatterns) || mentionsSpecificCase) {
    return { group: "restricted", includeOfficialSources: false };
  }
  return { group: "unknown", includeOfficialSources: false };
}
