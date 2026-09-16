/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const open = "";

    const categories = new Collection({
      type: "base",
      name: "categories",
      listRule: open,
      viewRule: open,
      createRule: open,
      updateRule: open,
      deleteRule: open,
      indexes: ["CREATE INDEX idx_categories_sort ON categories (sort_order)"],
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
          type: "number",
          name: "sort_order",
          min: 0,
        },
      ],
    });

    app.save(categories);

    const trackers = app.findCollectionByNameOrId("trackers");
    trackers.fields.add(
      new RelationField({
        name: "category",
        required: false,
        maxSelect: 1,
        collectionId: categories.id,
        cascadeDelete: false,
      })
    );
    app.save(trackers);
  },
  (app) => {
    const trackers = app.findCollectionByNameOrId("trackers");
    const field = trackers.fields.getByName("category");
    if (field) {
      trackers.fields.removeById(field.id);
      app.save(trackers);
    }
    try {
      app.delete(app.findCollectionByNameOrId("categories"));
    } catch (e) {
      /* ignore */
    }
  }
);
