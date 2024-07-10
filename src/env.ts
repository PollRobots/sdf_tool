import { Expression, isIdentifier, makeError } from "./dsl";
import { printExpr } from "./print";

export class Env {
  private parent?: Env;
  private values: Map<string, Expression> = new Map();
  private readonly generating_?: boolean;

  constructor(parent?: Env | undefined, generating?: boolean) {
    this.parent = parent;
    this.generating_ = generating;
  }

  get generating(): boolean {
    return this.parent ? this.parent.generating : !!this.generating_;
  }

  get keys(): Set<string> {
    const set = new Set(this.parent ? this.parent.keys : []);
    for (const key of this.values.keys()) {
      set.add(key);
    }
    return set;
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

  getExpr(expr: Expression): Expression {
    if (!isIdentifier(expr)) {
      return makeError(
        `Cannot perform environment lookup for ${printExpr(
          expr
        )}, it is not an identifier`,
        expr.offset,
        expr.length
      );
    }
    const value = this.get(expr.value as string);
    if (value === undefined) {
      return makeError(
        `${expr.value} is not defined`,
        expr.offset,
        expr.length
      );
    }
    return value;
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
