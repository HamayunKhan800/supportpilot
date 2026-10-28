import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";

const classes = (v: Parameters<typeof buttonVariants>[0]) => buttonVariants(v).split(/\s+/);

describe("buttonVariants", () => {
  it("keeps the outline border when used on its own (links styled as buttons)", () => {
    const list = classes({ variant: "outline" });
    expect(list).toContain("border-border");
    expect(list).not.toContain("border-transparent");
  });

  it("keeps the transparent base border for variants without one", () => {
    expect(classes({ variant: "default" })).toContain("border-transparent");
    expect(classes({ variant: "ghost" })).toContain("border-transparent");
  });

  it("lets a caller's className win over the variant", () => {
    const list = classes({ variant: "outline", size: "lg", className: "h-10" });
    expect(list).toContain("h-10");
    expect(list).not.toContain("h-9");
  });
});
