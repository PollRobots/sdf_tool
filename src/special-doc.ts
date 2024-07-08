export const kSpecialDoc = new Map<string, string[]>([
  [
    "if",
    [
      "(**if** *test* *then-expr* [*else-expr*])",
      "Evaluates *test*, if it produces a truthy result (anything other than " +
        "`0` or `()`), then the result of the expression is the evaluation of " +
        "*then-expr* is evaluated, otherwise it is the evaluation of the " +
        "*else-expr*, if provided, otherwise `()`",
    ],
  ],
  [
    "define",
    [
      "(**define** *name* *value*)",
      "Defines the identifier *name* to have the value *value* in the current " +
        "environment.",
      "*name* must be an identifier.",
      "(**define** *name* (*sym* ...) *body*)",
      "Defines the identifier *name* to be the lambda with the symbol list " +
        "*sym* ... and the body *body*",
      "This is equivalent to (define *name* (lambda (*sym* ...) *body*))",
    ],
  ],
  [
    "set!",
    [
      "(**set!** *name* *value*)",
      "Overwrites an existing define in the current environment with a new value.",
    ],
  ],
  [
    "lambda",
    [
      "(**lambda** (*sym* ...) *body*)",
      "Creates an anonymous function (a.k.a. lambda or λ) with the symbol list " +
        "(*sym* ...) and the provided *body*",
      "When a lambda is evaluated, a new environment is created from the " +
        "environment that was current when the lambda was declared, and with the " +
        "symbols in the symbol list defined to have the lambda argument values. " +
        "The body is then evaluated in that context.",
      "For example if the following lambdas are defined:",
      "```" +
        `
  (define pi 3.141592653589793)
  (define add (lambda (x y) (+ x y)))
  (define inc (lambda (x) (+ x 1)))
  (define inc-pi (lambda (x) (+ x pi)))
  ` +
        "```",
      "Then calling `(add 1 2)` will simply add 1 and 2, as they are " +
        "bound to the x and y symbols in the lambda definition, (inc 3) will " +
        "add 1 to 3 in the same manner, and (inc-pi 4) will add π to 4, " +
        "because when inc-pi was defined, and the lambda special form " +
        "evaluated, it captured the environment where pi was defined.",
    ],
  ],
  [
    "let",
    [
      "(**let** ((*sym* *expr*) ...) *body*)",
      "This evaluates the expressions in ((*sym* *expr*) ...) and binds them to " +
        "the corresponding symbols, then evaluates *body* in the context of those " +
        "bound symbols.",
      "This is equivalent to ((lambda (*sym*...) *body*) *expr* ...)",
    ],
  ],
  [
    "smoothcase",
    [
      "(**smoothcase** *value* *caseitem* ...)",
      "where **caseitem** is ((*low* [*high*]) *result*)",
      "This evaluates *value*, and each *low*, *high* and *result* in each " +
        "*caseitem*. For any *caseitem* with no *high* value, it is set to be " +
        "the same as *low*",
      "The value is then compared with each case item in turn.",
      "- If it is less than the *low* value of the first *caseitem*, then " +
        "the *result* of the first item is returned.",
      "- If it is less than *low*, then the value of `(mix prev_result result " +
        "(smoothstep prev_high low value))` is returned, where *prev_result* " +
        "and *prev_high* are the *result* and *high* values from the previous case.",
      "- If it is between *low* and *high*, then *result* is returned.",
      "- If this is the last case item, then *result* is returned",
      "- Otherwise evaluation proceeds with the next *caseitem*.",
      "If value and the caseitem elements are vectors, this is evaluated component-wise.",
    ],
  ],
]);
