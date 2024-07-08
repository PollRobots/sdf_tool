import { expect } from "chai";
import "mocha";

import { Expression } from "../src/dsl";
import { printExpr } from "../src/print";
import { evaluate } from "../src/evaluate";
import { Env } from "../src/env";
import { addBuiltins } from "../src/builtins";
import { tokenize, parse, read } from "../src/read";

describe("tokenize", () => {
  it("should identify paren", () => {
    const tokens = tokenize("()");
    expect(tokens).to.have.lengthOf(2);
    expect(tokens[0]).to.have.property("type", "punctuation");
    expect(tokens[0]).to.have.property("value", "(");
    expect(tokens[1]).to.have.property("type", "punctuation");
    expect(tokens[1]).to.have.property("value", ")");
  });

  it("should ignore whitespace", () => {
    const tokens = tokenize(" (\t\n) ");
    expect(tokens).to.have.lengthOf(2);
    expect(tokens[0]).to.have.property("type", "punctuation");
    expect(tokens[0]).to.have.property("value", "(");
    expect(tokens[1]).to.have.property("type", "punctuation");
    expect(tokens[1]).to.have.property("value", ")");
  });

  it("should ignore comments", () => {
    const tokens = tokenize("(;comment\n)");
    expect(tokens).to.have.lengthOf(2);
    expect(tokens[0]).to.have.property("type", "punctuation");
    expect(tokens[0]).to.have.property("value", "(");
    expect(tokens[1]).to.have.property("type", "punctuation");
    expect(tokens[1]).to.have.property("value", ")");
  });

  it("should handle numbers", () => {
    const tokens = tokenize("0 1 4726 1.23e4 -6 +7 1e3 5e-2");
    expect(tokens).to.have.lengthOf(8);
    expect(tokens[0]).to.have.property("value", 0);
    expect(tokens[1]).to.have.property("value", 1);
    expect(tokens[2]).to.have.property("value", 4726);
    expect(tokens[3]).to.have.property("value", 1.23e4);
    expect(tokens[4]).to.have.property("value", -6);
    expect(tokens[5]).to.have.property("value", +7);
    expect(tokens[6]).to.have.property("value", 1e3);
    expect(tokens[7]).to.have.property("value", 5e-2);
  });

  it("should handle identifiers", () => {
    const tokens = tokenize("a _b foo foo-bar + - * / < > <= >=");
    expect(tokens).to.have.lengthOf(12);
    expect(tokens[0]).to.have.property("value", "a");
    expect(tokens[1]).to.have.property("value", "_b");
    expect(tokens[2]).to.have.property("value", "foo");
    expect(tokens[3]).to.have.property("value", "foo-bar");
    expect(tokens[4]).to.have.property("value", "+");
    expect(tokens[5]).to.have.property("value", "-");
    expect(tokens[6]).to.have.property("value", "*");
    expect(tokens[7]).to.have.property("value", "/");
    expect(tokens[8]).to.have.property("value", "<");
    expect(tokens[9]).to.have.property("value", ">");
    expect(tokens[10]).to.have.property("value", "<=");
    expect(tokens[11]).to.have.property("value", ">=");
  });

  it("should handle vectors", () => {
    const tokens = tokenize("#<1 2 3>");
    expect(tokens).to.have.lengthOf(6);
    expect(tokens[0]).to.have.property("value", "(");
    expect(tokens[0]).to.have.property("reader", true);
    expect(tokens[1]).to.have.property("value", "vec");
    expect(tokens[1]).to.have.property("reader", true);
    expect(tokens[2]).to.have.property("value", 1);
    expect(tokens[3]).to.have.property("value", 2);
    expect(tokens[4]).to.have.property("value", 3);
    expect(tokens[5]).to.have.property("value", ")");
    expect(tokens[5]).to.have.property("reader", true);
  });
});

describe("parse", () => {
  it("should read a list", () => {
    const exprs = parse(tokenize("(+ 1 2)"));
    expect(exprs).to.have.lengthOf(1);
    expect(exprs[0]).to.have.property("type", "list");
    expect(exprs[0].value).to.be.an("array");
    const list = exprs[0].value as Expression[];
    expect(list).to.have.lengthOf(3);
    expect(list[0]).to.have.property("value", "+");
    expect(list[1]).to.have.property("value", 1);
    expect(list[2]).to.have.property("value", 2);
  });

  it("should read nested lists", () => {
    const exprs = parse(tokenize("(+ (* x x) (* y y))"));
    expect(exprs).to.have.lengthOf(1);
    expect(exprs[0]).to.have.property("type", "list");
    expect(exprs[0].value).to.be.an("array");
    const list = exprs[0].value as Expression[];
    expect(list).to.have.lengthOf(3);
    expect(list[0]).to.have.property("value", "+");
    expect(list[1].value).to.be.an("array");
    const sub = list[1].value as Expression[];
    expect(sub).to.have.lengthOf(3);
  });
});

describe("print", () => {
  it("should print a list", () => {
    expect(printExpr(parse(tokenize("(+ 1 2)"))[0])).to.equal("(+ 1 2)");
    expect(printExpr(parse(tokenize("(+ \t1;comment\n 2)"))[0])).to.equal(
      "(+ 1 2)"
    );
  });
  it("should print a nested list", () => {
    expect(
      printExpr(parse(tokenize("(sqrt (+ (* x x) (* y y)))"))[0])
    ).to.equal("(sqrt (+ (* x x) (* y y)))");
  });
});

describe("evaluate", () => {
  it("should evaluate simple addition", () => {
    const parsed = read("(+ 1 2 3)");
    const env = new Env();
    addBuiltins(env);

    const res = evaluate(parsed[0], env);
    expect(printExpr(res)).to.equal("6");
  });

  it("should evaluate simple multiplication", () => {
    const parsed = parse(tokenize("(* #<1 2 3> 4)"));
    const env = new Env();
    addBuiltins(env);

    const res = evaluate(parsed[0], env);
    expect(printExpr(res)).to.equal("#<4 8 12>");
  });
});

describe("special forms", () => {
  const basicEval = (input: string, env?: Env): Expression => {
    const parsed = read(input);
    expect(parsed).to.have.lengthOf(1);
    if (!env) {
      env = new Env();
      addBuiltins(env);
    }
    return evaluate(parsed[0], env);
  };

  it("'if' evaluates first branch if truthy", () => {
    expect(printExpr(basicEval("(if 1 2 3)"))).to.equal("2");
    expect(printExpr(basicEval("(if t 2)"))).to.equal("2");
  });

  it("'if' evaluates second branch if falsy", () => {
    expect(printExpr(basicEval("(if () 2 3)"))).to.equal("3");
    expect(printExpr(basicEval("(if 0 2 3)"))).to.equal("3");
  });

  it("'if' returns () if two arguments and falsy", () => {
    expect(printExpr(basicEval("(if () 2)"))).to.equal("()");
    expect(printExpr(basicEval("(if 0 2)"))).to.equal("()");
  });

  it("'define' adds to env", () => {
    const env = new Env();
    basicEval("(define a 7)", env);

    expect(printExpr(env.get("a"))).to.equal("7");
  });

  it("'lambda' creates a function that can be evaluated", () => {
    const res = basicEval("((lambda (x) (+ x 1)) 7)");
    expect(printExpr(res)).to.equal("8");
  });

  it("'let' creates a local scope", () => {
    const env = new Env();
    addBuiltins(env);
    const res = basicEval(
      `
        (let (
            (a 1)
            (b 2))
            (+ a b))`,
      env
    );
    expect(printExpr(res)).to.equal("3");
    expect(env.has("a")).to.be.false;
    expect(env.has("b")).to.be.false;
  });

  it("'begin' returns the value of the last expr", () => {
    const env = new Env();
    addBuiltins(env);
    const res = basicEval(
      `(begin
            (define a 2)
            (define b 3)
            (+ a b)
            (* a b))`,
      env
    );

    expect(printExpr(res)).to.equal("6");
    expect(printExpr(env.get("a"))).to.equal("2");
    expect(printExpr(env.get("b"))).to.equal("3");
  });

  it("'quote' returns its own argument", () => {
    const res = basicEval("(quote (1 2 3))");
    expect(printExpr(res)).to.equal("(1 2 3)");
  });

  it("\"'\" is a reader-macro for 'quote'", () => {
    expect(printExpr(read("'(1 2 3)")[0], false)).to.equal("(quote (1 2 3))");
    const res = basicEval("'(1 2 3)");
    expect(printExpr(res)).to.equal("(1 2 3)");
  });

  it("'quasi-quote' returns its own argument", () => {
    const res = basicEval("(quasi-quote (1 2 3))");
    expect(printExpr(res)).to.equal("(1 2 3)");
  });

  it("\"`\" is a reader-macro for 'quasi-quote'", () => {
    expect(printExpr(read("`(1 2 3)")[0], false)).to.equal(
      "(quasi-quote (1 2 3))"
    );
    const res = basicEval("`(1 2 3)");
    expect(printExpr(res)).to.equal("(1 2 3)");
  });

  it("'unquote' evaluates within a quasi-quote", () => {
    const res = basicEval("(quasi-quote (1 (unquote (+ 2 3)) 4))");
    expect(printExpr(res)).to.equal("(1 5 4)");
  });

  it("\",\" is a reader-macro for 'unquote'", () => {
    expect(printExpr(read("`(1 ,(+ 2 3) 4)")[0], false)).to.equal(
      "(quasi-quote (1 (unquote (+ 2 3)) 4))"
    );
    const res = basicEval("`(1 ,(+ 2 3) 4)");
    expect(printExpr(res)).to.equal("(1 5 4)");
  });

  it("'unquote-splicing' evaluates within a quasi-quote", () => {
    const res = basicEval("(quasi-quote (1 (unquote-splicing (list 2 3)) 4))");
    expect(printExpr(res)).to.equal("(1 2 3 4)");
  });

  it("evaluates builtin lambdas", () => {
    expect(printExpr(basicEval("(splat 2)"))).to.equal("#<2 2 2>");
    expect(printExpr(basicEval("(min-vec #<1 2 3>)"))).to.equal("1");
    expect(printExpr(basicEval("(max-vec #<1 2 3>)"))).to.equal("3");
  });

  it("evaluates builtin macros", () => {
    expect(printExpr(basicEval("(and 1 2)"))).to.equal("2");
    expect(printExpr(basicEval("(and 1 0)"))).to.equal("0");
    expect(printExpr(basicEval("(and 0 2)"))).to.equal("0");
    expect(printExpr(basicEval("(and 0 0)"))).to.equal("0");
    expect(printExpr(basicEval("(and 1 ())"))).to.equal("()");
    expect(printExpr(basicEval("(and () 2)"))).to.equal("()");
    expect(printExpr(basicEval("(and () 0)"))).to.equal("()");
    expect(printExpr(basicEval("(and 0 ())"))).to.equal("0");
    expect(printExpr(basicEval("(and () ())"))).to.equal("()");

    expect(printExpr(basicEval("(or 1 2)"))).to.equal("1");
    expect(printExpr(basicEval("(or 1 0)"))).to.equal("1");
    expect(printExpr(basicEval("(or 0 2)"))).to.equal("2");
    expect(printExpr(basicEval("(or 0 0)"))).to.equal("0");
    expect(printExpr(basicEval("(or 1 ())"))).to.equal("1");
    expect(printExpr(basicEval("(or () 2)"))).to.equal("2");
    expect(printExpr(basicEval("(or () 0)"))).to.equal("0");
    expect(printExpr(basicEval("(or 0 ())"))).to.equal("()");
    expect(printExpr(basicEval("(or () ())"))).to.equal("()");
  });

  it("doesn't evaluate macro args early", () => {
    const env = new Env();
    addBuiltins(env);
    const res = basicEval(
      `(begin
        (define left 0)
        (define right 0)
        (and
            (begin
                (set! left 1)
                0)
            (begin
                (set! right 2)
                right)))`,
      env
    );
    expect(printExpr(res)).to.equal("0");
    expect(printExpr(env.get("left"))).to.equal("1");
    expect(printExpr(env.get("right"))).to.equal("0");

    const resOr = basicEval(
      `(begin
        (set! left 0)
        (set! right 0)
        (or
            (begin
                (set! left 1)
                left)
            (begin
                (set! right 2)
                right)))`,
      env
    );
    expect(printExpr(resOr)).to.equal("1");
    expect(printExpr(env.get("left"))).to.equal("1");
    expect(printExpr(env.get("right"))).to.equal("0");
  });

  it("should handle variable length macro args", () => {
    expect(
      printExpr(basicEval("(union (sphere #<1 1 1> 1) (sphere #<2 1 1> 1))"))
    ).to.equal(
      "#shape<union: #shape<sphere: #<1 1 1> 1> #shape<sphere: #<2 1 1> 1>>"
    );

    expect(
      printExpr(
        basicEval("(union 0.1 (sphere #<1 1 1> 1) (sphere #<2 1 1> 1))")
      )
    ).to.equal(
      "#shape<union: 0.1 #shape<sphere: #<1 1 1> 1> #shape<sphere: #<2 1 1> 1>>"
    );

    expect(
      printExpr(
        basicEval(
          "(let ((k 0.1)) (union k (sphere #<1 1 1> 1) (sphere #<2 1 1> 1)))"
        )
      )
    ).to.equal(
      "#shape<union: 0.1 #shape<sphere: #<1 1 1> 1> #shape<sphere: #<2 1 1> 1>>"
    );
  });

  describe("placeholders", () => {
    it("prevent complete evaluation", () => {
      expect(printExpr(basicEval("(+ 1 :x 2)"))).to.equal(
        "(placeholder (+ 1 :x 2))"
      );

      expect(printExpr(basicEval("(+ (* :x :x) (* 3 3))"))).to.equal(
        "(placeholder (+ (* :x :x) 9))"
        // (lambda (_x) (+ (* _x _x) 9))
      );
    });

    it("escape from lambdas", () => {
      expect(
        printExpr(
          basicEval(`(begin
            (define incr (lambda (x) (+ x 1)))
            (incr :y))`)
        )
      ).to.equal("(placeholder (+ :y 1))");
    });

    describe("in if", () => {
      it("prevent evaluation in test expr", () => {
        expect(printExpr(basicEval("(if :x 1 2)"))).to.equal(
          "(placeholder (if :x 1 2))"
        );
      });
      it("ignored in unchosen branch", () => {
        expect(printExpr(basicEval("(if t 1 :x)"))).to.equal("1");
        expect(printExpr(basicEval("(if () :x 2)"))).to.equal("2");
      });
      it("result in chosen branch", () => {
        expect(printExpr(basicEval("(if t :x 2)"))).to.equal(":x");
        expect(printExpr(basicEval("(if () 1 :y)"))).to.equal(":y");
      });
    });

    describe("in define or set!", () => {
      it("propagate to evaluation", () => {
        expect(
          printExpr(
            basicEval(`(begin
                (define a :x)
                (+ a 2)
                )`)
          )
        ).to.equal("(placeholder (+ :x 2))");
        expect(
          printExpr(
            basicEval(`(begin
                (define p 2)
                (define q (+ p 1))
                (set! p :p)
                (+ q p)
                )`)
          )
        ).to.equal("(placeholder (+ 3 :p))");
        // (lambda (_p) (+ 3 _p))
      });
    });

    describe("in lambda", () => {
      it("propagate to result from body", () => {
        expect(printExpr(basicEval(`((lambda (x) (+ x :inc)) 7)`))).to.equal(
          "(placeholder (+ 7 :inc))"
        );
      });
      it("propagate to result from args", () => {
        expect(printExpr(basicEval(`((lambda (x) (+ x 1)) :y)`))).to.equal(
          "(placeholder (+ :y 1))"
        );
        expect(printExpr(basicEval(`((lambda (x) (if x x 0)) :y)`))).to.equal(
          "(placeholder (let ((x :y)) (if :y x 0)))"
        );
      });
      it("cause an error when used in symbol list", () => {
        expect(printExpr(basicEval(`((lambda (:x) (+ :x :inc)) 7)`)))
          .to.match(/^#error\</)
          .and.match(/list of symbols/);
      });
    });

    describe("in quasi-quote", () => {
      it("are untouched in the quoted portion", () => {
        expect(printExpr(basicEval("`(+ 1 :x ,(- 4 1))"))).to.equal(
          "(+ 1 :x 3)"
        );
      });
      it("prevent evaluation in the unquoted portion", () => {
        expect(printExpr(basicEval("`(+ 1 2 ,(- :x 1))"))).to.equal(
          "(+ 1 2 (placeholder (- :x 1)))"
        );
      });
    });

    describe("in macro", () => {
      it("capture the state of the expanded macro when the placeholder needed evaluation", () => {
        expect(printExpr(basicEval("(and 1 2 0 :x 3)"))).to.equal("0");
        expect(printExpr(basicEval("(and 1 2 :x 0)"))).to.equal(
          "(placeholder (let ((aa :x)) (if :x (and 0) aa)))"
          // (lambda (_x) ((lambda (aa) (if _x (and 0) aa)) _x))
        );
      });
    });
  });
});
