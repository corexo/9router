import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias } from "@/models";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// LLM kind sentinel (matches /api/v1/models)
const LLM_KIND = "llm";

// GET /api/models - Live model list per provider (delegates to the same
// builder as /api/v1/models: active connections, live provider resolvers,
// catalog + custom models, disabled models already excluded).
export async function GET() {
  try {
    const [list, modelAliases] = await Promise.all([
      buildModelsList([LLM_KIND]),
      getModelAliases(),
    ]);

    const models = list.map((m) => {
      const idx = m.id.indexOf("/");
      const providerAlias = idx > 0 ? m.id.slice(0, idx) : m.owned_by || m.id;
      const modelId = idx > 0 ? m.id.slice(idx + 1) : m.id;
      const c = getCapabilitiesForModel(providerAlias, modelId);
      return {
        provider: providerAlias,
        model: modelId,
        name: m.name || modelId,
        fullModel: m.id,
        routedModel: m.id,
        alias: modelAliases[m.id] || modelId,
        caps: {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
        },
      };
    });

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(model, alias);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}
