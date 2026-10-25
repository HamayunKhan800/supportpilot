import { Plus, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeCategory, SETTINGS_LIMITS as L } from "@/server/modules/settings/limits";

/**
 * The category list in the AI settings form: chips with a remove button, and a field to add one.
 * The form owns the values (Discard changes resets them); this only draws them.
 */
export function CategoryEditor({
  categories,
  listError,
  newCategory,
  addError,
  onNewCategoryChange,
  onAdd,
  onRemove,
}: {
  categories: string[];
  /** A server error about the list as a whole or one of its items. */
  listError: string | undefined;
  newCategory: string;
  /** Why the typed name can't be added, or "". */
  addError: string;
  onNewCategoryChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (category: string) => void;
}) {
  const addHintId = useId();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Categories</legend>
      <p className="text-muted-foreground text-sm">
        What triage can choose from and what agents can set. Tickets keep a removed category until someone
        changes it.
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="Current categories">
        {categories.map((c) => (
          <li key={c} className="bg-muted flex items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2.5 text-sm">
            {c}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${c}`}
              disabled={categories.length <= L.categories.min}
              onClick={() => onRemove(c)}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {listError && <p className="text-destructive text-sm">{listError}</p>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newCategory">New category</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="newCategory"
            className="h-10 max-w-xs"
            value={newCategory}
            maxLength={60}
            aria-describedby={addError ? `${addHintId} newCategory-error` : addHintId}
            aria-invalid={addError ? true : undefined}
            onChange={(e) => onNewCategoryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // add the category, don't submit the form
                onAdd();
              }
            }}
          />
          <Button type="button" variant="outline" className="h-10" onClick={onAdd}>
            <Plus aria-hidden="true" />
            Add category
          </Button>
        </div>
        <p id={addHintId} className="text-muted-foreground text-sm">
          {newCategory && normalizeCategory(newCategory)
            ? `Will be added as “${normalizeCategory(newCategory)}”.`
            : "Lower-case words joined by hyphens, e.g. feature-request."}
        </p>
        {addError && (
          <p id="newCategory-error" className="text-destructive text-sm">
            {addError}
          </p>
        )}
      </div>
    </fieldset>
  );
}
