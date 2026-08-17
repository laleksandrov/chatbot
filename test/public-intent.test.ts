import { describe, expect, it } from "vitest";

import { classifyPublicIntent, type PublicIntentGroup } from "../src/public-intent.js";

describe("classifyPublicIntent", () => {
  it.each<[string, PublicIntentGroup]>([
    ["Какво прави тази платформа?", "platform_capabilities"],
    ["Какво мога да правя тук?", "platform_capabilities"],
    ["С какво ще ми помогнете?", "platform_capabilities"],
    ["Какво предлагате освен регистрация на фирма?", "platform_capabilities"],
    ["Мога ли да сменя управителя през платформата?", "platform_capabilities"],
    ["Мога ли да публикувам ГФО?", "platform_capabilities"],
    ["Може ли чужденец да използва EasyStart?", "platform_capabilities"],
    ["Безплатна ли е платформата?", "platform_pricing"],
    ["Колко струва счетоводството?", "platform_pricing"],
    ["Какви са разходите за регистрация?", "external_registration_costs"],
    ["Колко осигуровки ще плащам?", "restricted"],
    ["Какъв данък дължа по тази конкретна сделка?", "restricted"],
  ])("classifies %s as %s", (message, expected) => {
    expect(classifyPublicIntent(message).group).toBe(expected);
  });

  it.each<[string, PublicIntentGroup]>([
    ["За какво служи EasyStart?", "platform_capabilities"],
    ["Имате ли начин сам да подам документите на гише?", "platform_capabilities"],
    ["Какви документи са нужни?", "platform_capabilities"],
    ["Колко време отнема?", "platform_capabilities"],
    ["Какво става при отказ?", "platform_capabilities"],
    ["Поддържате ли прехвърляне на дялове?", "platform_capabilities"],
    ["Работи ли услугата за човек, който живее извън България?", "platform_capabilities"],
    ["На какъв език са документите?", "platform_capabilities"],
    ["Каква е месечната тарифа за фирма по ДДС?", "platform_pricing"],
    ["Има ли депозит или минимален срок за счетоводната услуга?", "platform_pricing"],
    ["Кои лица се броят?", "platform_pricing"],
    ["Кога се плаща?", "platform_pricing"],
    ["Колко струва адвокатът?", "platform_pricing"],
    ["Какво включвате и каква е цената?", "platform_mixed"],
    ["Мога ли после да премина към платен вариант?", "platform_mixed"],
    ["Колко е нотариалната такса при учредяване?", "external_registration_costs"],
    ["Как се осчетоводява тази фактура?", "restricted"],
  ])("handles the paraphrase %s", (message, expected) => {
    expect(classifyPublicIntent(message).group).toBe(expected);
  });
});
