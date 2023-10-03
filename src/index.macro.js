import { createMacro } from "babel-plugin-macros";
import parse from "babel-literal-to-ast";
import gql from "graphql-tag";

module.exports = createMacro(graphqlTagMacro);

function graphqlTagMacro({ references, babel }) {
  references.default.forEach((path) => {
    if (path.parentPath.type === "TaggedTemplateExpression") {
      compile(babel, path.parentPath);
    }
  });
}

const queryStringCache = {}; // keyed by variable name, values of {query: string}

function compile(babel, path) {
  const t = babel.types;
  const source = path.node.quasi.quasis.map((node) => node.value.raw).join("");
  const expressions = path.get("quasi").get("expressions");

  expressions.forEach((expr) => {
    if (!t.isIdentifier(expr) && !t.isMemberExpression(expr)) {
      throw expr.buildCodeFrameError(
        "Only identifiers or member expressions are allowed by this macro as an interpolation in a graphql template literal."
      );
    }
  });

  const gqlDocument = gql(source);
  const compiled = parse(gqlDocument);
  const fragmentNames = [];

  if (expressions.length) {
    const definitionsProperty = compiled.properties.find(
      (p) => p.key.value === "definitions"
    );
    const definitionsArray = definitionsProperty.value;

    const extraDefinitions = expressions.map((expr) => {
      fragmentNames.push(expr.node.name);
      return t.memberExpression(expr.node, t.identifier("definitions"));
    });

    definitionsProperty.value = t.callExpression(
      t.memberExpression(definitionsArray, t.identifier("concat")),
      extraDefinitions
    );
  }

  if (fragmentNames.length) {
    let query = source;
    if (fragmentNames.length) {
      query = fragmentNames.reduce(
        (baseQuery, key) => `${queryStringCache[key].query}${baseQuery}`,
        query
      );
    }
    queryStringCache[path.parent.id.name] = {
      query,
    };

    // replace existing source with consolidated one
    const locProperty = compiled.properties.find((p) => p.key.value === "loc");
    const srcProperty = locProperty.value.properties.find(
      (p) => p.key.value === "source"
    );
    const bodyProperty = srcProperty.value.properties.find(
      (p) => p.key.value === "body"
    );
    bodyProperty.value = t.stringLiteral(query);
  } else {
    queryStringCache[path.parent.id.name] = {
      query: gqlDocument.loc.source.body,
    };
  }
  path.replaceWith(compiled);
}
