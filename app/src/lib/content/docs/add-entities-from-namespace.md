# Add Entities from Namespace

Places every class of one namespace on the active workspace at once, instead of using **Add Entity** for
each class.

## Opening it

- **Toolbar:** click the chevron on the **+ Add Entity** button and choose **Add entities from namespace…**.
  The classes land on a grid starting at the centre of the current view. The same menu also holds
  **Add attributed relationship…** (see [Association Form](association-form)) and **Add external class…**
  (see [External Class Form](external-class-form)).
- **Canvas menu:** Option/Alt+click an empty spot on the canvas and choose **Add entities from namespace…**.
  The grid starts at the point you clicked.

## The dialog

1. Choose a **Namespace**. The dialog opens with the active namespace preselected.
2. Its classes are listed with a checkbox each, all ticked. Untick any class you do not want.
3. Classes already on the workspace are shown disabled and unticked, labelled *already on workspace*. They are
   never moved.
4. **Select all / Select none** only affects the classes that can be added.
5. The confirm button shows how many classes will be added (for example **Add 12 classes**) and is disabled
   when none are ticked.

## Notes

- Only classes are added; individuals are not. Association classes count as classes.
- The classes are saved in one write, so adding a large namespace is fast.
- If the namespace is hidden in the [Namespace Filter](namespace-filter), the classes are added but stay
  invisible until you show the namespace, and a message says so.

## Related

- [Entity Form](entity-form)
- [Namespace Filter](namespace-filter)
- [Namespace Model](namespace-model)
