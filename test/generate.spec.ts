import { expect } from "chai";
import "mocha";
import { GenerateContext, generate, makeContext } from "../src/generate";
import { makeNumber, makeVector } from "../src/dsl";
import { read } from "../src/read";
import { Env } from "../src/env";
import { addBuiltins } from "../src/builtins";
import { evaluate } from "../src/evaluate";

describe("generate", () => {
  it("numbers as numbers", () => {
    const env = new Env();
    expect(generate(makeNumber(7.2), env)).to.have.property("code", "7.2");
  });

  it("vectors as vectors", () => {
    const env = new Env();
    expect(generate(makeVector(1, 2, 3), env)).to.have.property(
      "code",
      "vec3<f32>(1, 2, 3)"
    );
  });

  it("+ is addition", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(+)")[0], env)).to.have.property("code", "0.0");
    expect(generate(read("(+ 1)")[0], env)).to.have.property("code", "1");
    expect(generate(read("(+ 1 2)")[0], env)).to.have.property("code", "1 + 2");
    expect(generate(read("(+ 1 2 3)")[0], env)).to.have.property(
      "code",
      "1 + 2 + 3"
    );
  });

  it("- is subtraction", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(-)")[0], env)).to.have.property("code", "0.0");
    expect(generate(read("(- 1)")[0], env)).to.have.property("code", "-1");
    expect(generate(read("(- 1 2)")[0], env)).to.have.property("code", "1 - 2");
    expect(generate(read("(- 1 2 3)")[0], env)).to.have.property(
      "code",
      "1 - 2 - 3"
    );
  });

  it("* is multiplication", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(*)")[0], env)).to.have.property("code", "1.0");
    expect(generate(read("(* 1)")[0], env)).to.have.property("code", "1");
    expect(generate(read("(* 1 2)")[0], env)).to.have.property("code", "1 * 2");
    expect(generate(read("(* 1 2 3)")[0], env)).to.have.property(
      "code",
      "1 * 2 * 3"
    );
  });

  it("/ is division", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(/)")[0], env)).to.have.property("code", "1.0");
    expect(generate(read("(/ 3)")[0], env)).to.have.property("code", "1.0 / 3");
    expect(generate(read("(/ 3 2)")[0], env)).to.have.property("code", "3 / 2");
    expect(generate(read("(/ 4 3 2)")[0], env)).to.have.property(
      "code",
      "4 / 3 / 2"
    );
  });

  it("dot is a function call", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(dot #<1 2 3> #<4 5 6>)")[0], env)).to.have.property(
      "code",
      "dot(vec3<f32>(1, 2, 3), vec3<f32>(4, 5, 6))"
    );
  });

  it("cross is a function call", () => {
    const env = new Env();
    addBuiltins(env);

    expect(
      generate(read("(cross #<1 2 3> #<4 5 6>)")[0], env)
    ).to.have.property("code", "cross(vec3<f32>(1, 2, 3), vec3<f32>(4, 5, 6))");
  });

  it("abs is a function call", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(abs #<1 -2 3>)")[0], env)).to.have.property(
      "code",
      "abs(vec3<f32>(1, -2, 3))"
    );
  });

  it("min nests calls", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(min)")[0], env)).to.have.property("code", "0.0");
    expect(generate(read("(min 3)")[0], env)).to.have.property("code", "3");
    expect(generate(read("(min 3 2)")[0], env)).to.have.property(
      "code",
      "min(3, 2)"
    );
    expect(generate(read("(min 4 3 2)")[0], env)).to.have.property(
      "code",
      "min(4, min(3, 2))"
    );
  });

  it("max nests calls", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(max)")[0], env)).to.have.property("code", "0.0");
    expect(generate(read("(max 3)")[0], env)).to.have.property("code", "3");
    expect(generate(read("(max 3 2)")[0], env)).to.have.property(
      "code",
      "max(3, 2)"
    );
    expect(generate(read("(max 4 3 2)")[0], env)).to.have.property(
      "code",
      "max(4, max(3, 2))"
    );
  });

  it("lambda is inlined", () => {
    const env = new Env();
    addBuiltins(env);

    const lambda = read("((lambda (x y) (+ x y)) 1 2)")[0];
    expect(generate(lambda, env)).to.have.property("code", "1 + 2");
  });

  it("shape generates sdf call", () => {
    const env = new Env();
    addBuiltins(env);
    const ctx = makeContext({});
    const shape = evaluate(read("(sphere #<1 2 3> 4)")[0], env);
    expect(generate(shape, env, ctx)).to.have.property(
      "code",
      "sdfSphere(p, t, k, vec3<f32>(1, 2, 3), 4)"
    );
    expect(ctx.dependencies).to.have.key("sdfSphere");
  });

  it("shape special form expands in placeholder", () => {
    const env = new Env();
    addBuiltins(env);
    const ctx = makeContext({});
    const shape = evaluate(read("(sphere #<1 :x 3> 4)")[0], env);
    expect(generate(shape, env, ctx)).to.have.property(
      "code",
      "sdfSphere(p, t, k, vec3<f32>(1, uniforms.values[0], 3), 4)"
    );
    expect(ctx.dependencies).to.have.key("sdfSphere");
  });

  it("if generates conditional when both branches are immediate", () => {
    const env = new Env();
    addBuiltins(env);
    const ctx = makeContext({});

    const cond = read("(if (< 1 :x) (splat 3) 4)")[0];
    expect(generate(cond, env, ctx)).to.have.property(
      "code",
      "1 < uniforms.values[0] ? vec3<f32>(3) : vec3<f32>(4)"
    );
  });

  it("if generates if when either branch is not immediate", () => {
    const env = new Env();
    addBuiltins(env);
    const ctx = makeContext({});

    const cond = read(
      "(if (< 1 :x) (smooth 0.1 (sphere #<1> 1)) (sphere #<2> 2))"
    )[0];
    expect(generate(cond, env, ctx)).to.have.property(
      "code",
      `if (1 < uniforms.values[0]) {
  var k = 0.1;
  res = sdfSphere(p, t, k, vec3<f32>(1), 1);
} else {
  res = sdfSphere(p, t, k, vec3<f32>(2), 2);
}`
    );
  });
});
