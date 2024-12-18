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
    expect(generate(makeNumber(7.2, 0, 0), env)).to.have.property(
      "code",
      "7.2"
    );
  });

  it("vectors as vectors", () => {
    const env = new Env();
    expect(generate(makeVector(1, 2, 3, 0, 0), env)).to.have.property(
      "code",
      "vec3<f32>(1, 2, 3)"
    );
  });

  it("+ is addition", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(+)")[0], env)).to.have.property("code", "0.0");
    expect(generate(read("(+ 1)")[0], env)).to.have.property("code", "1");
    expect(generate(read("(+ 1 2)")[0], env)).to.have.property(
      "code",
      "(1 + 2)"
    );
    expect(generate(read("(+ 1 2 3)")[0], env)).to.have.property(
      "code",
      "(1 + 2 + 3)"
    );
  });

  it("- is subtraction", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(-)")[0], env)).to.have.property("code", "0.0");
    expect(generate(read("(- 1)")[0], env)).to.have.property("code", "-1");
    expect(generate(read("(- 1 2)")[0], env)).to.have.property(
      "code",
      "(1 - 2)"
    );
    expect(generate(read("(- 1 2 3)")[0], env)).to.have.property(
      "code",
      "(1 - 2 - 3)"
    );
  });

  it("* is multiplication", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(*)")[0], env)).to.have.property("code", "1.0");
    expect(generate(read("(* 1)")[0], env)).to.have.property("code", "1");
    expect(generate(read("(* 1 2)")[0], env)).to.have.property(
      "code",
      "(1 * 2)"
    );
    expect(generate(read("(* 1 2 3)")[0], env)).to.have.property(
      "code",
      "(1 * 2 * 3)"
    );
  });

  it("/ is division", () => {
    const env = new Env();
    addBuiltins(env);

    expect(generate(read("(/)")[0], env)).to.have.property("code", "1.0");
    expect(generate(read("(/ 3)")[0], env)).to.have.property(
      "code",
      "(1.0 / 3)"
    );
    expect(generate(read("(/ 3 2)")[0], env)).to.have.property(
      "code",
      "(3 / 2)"
    );
    expect(generate(read("(/ 4 3 2)")[0], env)).to.have.property(
      "code",
      "(4 / 3 / 2)"
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
    const env = new Env(undefined, true);
    addBuiltins(env);
    const ctx = makeContext({});

    const lambda = read("((lambda (x y) (+ x y)) 1 2)")[0];
    expect(generate(lambda, env, ctx)).to.have.property(
      "code",
      "lambda_anon(p, col, 1, 2)"
    );
    expect(ctx.generatedLambdas).to.have.lengthOf(1);
    expect(ctx.generatedLambdas[0]).to.have.property("name", "lambda_anon");
    expect(ctx.generatedLambdas[0]).to.have.property(
      "code",
      `fn lambda_anon(
  p: vec3<f32>,
  col: vec3<f32>,
  x: f32,
  y: f32,
) -> f32 {
  return (x + y);
}`
    );
  });

  it("shape generates sdf call", () => {
    const env = new Env();
    addBuiltins(env);
    const ctx = makeContext({});
    const shape = evaluate(read("(sphere #<1 2 3> 4)")[0], env);
    expect(generate(shape, env, ctx)).to.have.property(
      "code",
      "sdfSphere(p, vec3<f32>(1, 2, 3), 4)"
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
      "sdfSphere(p, vec3<f32>(1, {%x%}, 3), 4)"
    );
    expect(ctx.dependencies).to.have.key("sdfSphere");
  });

  it("if generates select when both branches are immediate", () => {
    const env = new Env();
    addBuiltins(env);
    const ctx = makeContext({});

    const cond = read("(if (< 1 :x) (splat 3) 4)")[0];
    expect(generate(cond, env, ctx)).to.have.property(
      "code",
      "select(vec3<f32>(4), vec3<f32>(3), (1 < {%x%}))"
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
      `if ((1 < {%x%})) {
  var k: f32 = 0.1;
  res = sdfSphere(p, vec3<f32>(1), 1);
} else {
  res = sdfSphere(p, vec3<f32>(2), 2);
}`
    );
  });
  it("if generates select for placeholder branches", () => {
    const env = new Env();
    addBuiltins(env);
    const ctx = makeContext({});

    const cond = read("(if (< 1 :x) :true :false)")[0];
    expect(generate(cond, env, ctx)).to.have.property(
      "code",
      `select({%false%}, {%true%}, (1 < {%x%}))`
    );
  });
});
