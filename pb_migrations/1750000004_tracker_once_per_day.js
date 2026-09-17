/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const trackers = app.findCollectionByNameOrId("trackers");
    trackers.fields.add(
      new BoolField({
        name: "once_per_day",
      })
    );
    app.save(trackers);
  },
  (app) => {
    const trackers = app.findCollectionByNameOrId("trackers");
    const field = trackers.fields.getByName("once_per_day");
    if (field) {
      trackers.fields.removeById(field.id);
      app.save(trackers);
    }
  }
);
