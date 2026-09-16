/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const categories = app.findCollectionByNameOrId("categories");
  const trackers = app.findCollectionByNameOrId("trackers");

  const catSeeds = [
    { name: "Gezondheid", icon: "🩺", color: "#f43f5e", sort_order: 1 },
    { name: "Dagelijks", icon: "☀️", color: "#38bdf8", sort_order: 2 },
    { name: "Voeding", icon: "🍽️", color: "#fb923c", sort_order: 3 },
    { name: "Overig", icon: "📦", color: "#94a3b8", sort_order: 99 },
  ];

  const catIds = {};
  catSeeds.forEach((seed) => {
    const record = new Record(categories);
    record.set("name", seed.name);
    record.set("icon", seed.icon);
    record.set("color", seed.color);
    record.set("sort_order", seed.sort_order);
    app.save(record);
    catIds[seed.name] = record.id;
  });

  const assign = {
    Douche: "Dagelijks",
    Lenzen: "Dagelijks",
    Medicijnen: "Gezondheid",
    Hoofdpijn: "Gezondheid",
    Eten: "Voeding",
    Water: "Voeding",
    Stemming: "Gezondheid",
    Sport: "Overig",
    Slaap: "Gezondheid",
  };

  const trackerRecords = app.findRecordsByFilter(trackers, 'id != ""');
  for (const record of trackerRecords) {
    const name = record.get("name");
    const catName = assign[name] || "Overig";
    record.set("category", catIds[catName]);
    app.save(record);
  }
});
