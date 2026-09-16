/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const trackers = app.findCollectionByNameOrId("trackers");

  const seeds = [
    {
      name: "Douche",
      icon: "🚿",
      color: "#38bdf8",
      type: "check",
      description: "Heb je vandaag gedoucht?",
      sort_order: 1,
    },
    {
      name: "Lenzen",
      icon: "👁️",
      color: "#22d3ee",
      type: "check",
      description: "Lenzen in of uit",
      sort_order: 2,
    },
    {
      name: "Medicijnen",
      icon: "💊",
      color: "#a78bfa",
      type: "counter",
      description: "Tik +1 per inname",
      sort_order: 3,
    },
    {
      name: "Hoofdpijn",
      icon: "🤕",
      color: "#f43f5e",
      type: "scale",
      description: "Hoe hevig is de hoofdpijn?",
      options: { min: 1, max: 10 },
      sort_order: 4,
    },
    {
      name: "Eten",
      icon: "🍽️",
      color: "#fb923c",
      type: "text",
      description: "Wat heb je gegeten?",
      sort_order: 5,
    },
    {
      name: "Water",
      icon: "💧",
      color: "#60a5fa",
      type: "counter",
      unit: "glazen",
      description: "Tik +1 per glas",
      sort_order: 6,
    },
    {
      name: "Stemming",
      icon: "🙂",
      color: "#facc15",
      type: "choice",
      options: {
        choices: ["😊 Super", "🙂 Goed", "😐 Neutraal", "😔 Down", "😢 Slecht"],
      },
      sort_order: 7,
    },
    {
      name: "Sport",
      icon: "🏃",
      color: "#4ade80",
      type: "choice",
      options: {
        choices: ["Wandelen", "Hardlopen", "Kracht", "Fietsen", "Yoga", "Anders"],
      },
      sort_order: 8,
    },
    {
      name: "Slaap",
      icon: "😴",
      color: "#818cf8",
      type: "number",
      unit: "uur",
      options: { min: 0, max: 16, step: 0.5 },
      description: "Hoeveel uur heb je geslapen?",
      sort_order: 9,
    },
  ];

  seeds.forEach((seed) => {
    const record = new Record(trackers);
    record.set("name", seed.name);
    record.set("icon", seed.icon);
    record.set("color", seed.color);
    record.set("type", seed.type);
    record.set("unit", seed.unit || "");
    record.set("description", seed.description || "");
    record.set("options", seed.options || {});
    record.set("sort_order", seed.sort_order);
    record.set("archived", false);
    app.save(record);
  });
});
