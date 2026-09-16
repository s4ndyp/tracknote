/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const open = "";

    const trackers = new Collection({
      type: "base",
      name: "trackers",
      listRule: open,
      viewRule: open,
      createRule: open,
      updateRule: open,
      deleteRule: open,
      indexes: [
        "CREATE INDEX idx_trackers_sort ON trackers (sort_order)",
        "CREATE INDEX idx_trackers_archived ON trackers (archived)",
      ],
      fields: [
        {
          type: "text",
          name: "name",
          required: true,
          min: 1,
          max: 80,
        },
        {
          type: "text",
          name: "icon",
          required: false,
          max: 16,
        },
        {
          type: "text",
          name: "color",
          required: true,
          max: 16,
        },
        {
          type: "select",
          name: "type",
          required: true,
          maxSelect: 1,
          values: ["counter", "check", "choice", "number", "scale", "text"],
        },
        {
          type: "text",
          name: "unit",
          required: false,
          max: 32,
        },
        {
          type: "json",
          name: "options",
        },
        {
          type: "text",
          name: "description",
          required: false,
          max: 240,
        },
        {
          type: "number",
          name: "sort_order",
          min: 0,
        },
        {
          type: "bool",
          name: "archived",
        },
      ],
    });

    app.save(trackers);

    const entries = new Collection({
      type: "base",
      name: "entries",
      listRule: open,
      viewRule: open,
      createRule: open,
      updateRule: open,
      deleteRule: open,
      indexes: [
        "CREATE INDEX idx_entries_logged_at ON entries (logged_at)",
        "CREATE INDEX idx_entries_tracker ON entries (tracker)",
        "CREATE INDEX idx_entries_tracker_logged ON entries (tracker, logged_at)",
      ],
      fields: [
        {
          type: "relation",
          name: "tracker",
          required: true,
          maxSelect: 1,
          collectionId: trackers.id,
          cascadeDelete: true,
        },
        {
          type: "date",
          name: "logged_at",
          required: true,
        },
        {
          type: "number",
          name: "value_number",
        },
        {
          type: "text",
          name: "value_text",
          required: false,
          max: 500,
        },
        {
          type: "text",
          name: "note",
          required: false,
          max: 1000,
        },
      ],
    });

    app.save(entries);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("entries"));
    } catch (e) {
      /* ignore */
    }
    try {
      app.delete(app.findCollectionByNameOrId("trackers"));
    } catch (e) {
      /* ignore */
    }
  }
);
