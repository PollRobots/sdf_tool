import { Expression } from "./dsl";

export class Env {
  parent?: Env;
  values: Map<string, Expression> = new Map();

  constructor(parent: Env | undefined = undefined) {
    this.parent = parent;
  }

  has(name: string, local: boolean = false): boolean {
    if (this.values.has(name)) {
      return true;
    } else if (!local && this.parent) {
      return this.parent.has(name);
    } else {
      return false;
    }
  }

  get(name: string): Expression | undefined {
    const local = this.values.get(name);
    if (local) {
      return local;
    } else if (this.parent) {
      return this.parent.get(name);
    } else {
      return;
    }
  }

  set(name: string, exp: Expression, force?: boolean) {
    if (force) {
      if (this.values.has(name)) {
        this.values.set(name, exp);
      } else if (this.parent && this.parent.has(name)) {
        this.parent.set(name, exp, true);
      } else {
        this.values.set(name, exp);
      }
    } else {
      if (this.values.has(name)) {
        return { type: "error", value: `Cannot mutate value of '${name}'` };
      }
      this.values.set(name, exp);
    }
  }
}
