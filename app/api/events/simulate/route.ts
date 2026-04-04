/**
 * Event Simulation API — мульти-сценарный анализ событий
 * 
 * Поддерживает:
 * - Multiple scenarios (baseline, optimistic, pessimistic)
 * - Cross-domain analysis (political, economic, military, tech)
 * - Impact assessment with probability scoring
 * - Timeline generation
 * 
 * Пример запроса:
 * {
 *   "event": "New sanctions imposed on country X",
 *   "domains": ["political", "economic"],
 *   "scenarios": ["baseline", "optimistic", "pessimistic"],
 *   "timeHorizon": "30d"
 * }
 */

interface ScenarioResult {
  scenario: 'baseline' | 'optimistic' | 'pessimistic'
  probability: number
  description: string
  impacts: Array<{
    domain: string
    impact: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    timeline: string
  }>
  cascadingEffects: string[]
}

interface SimulationRequest {
  event: string
  domains: ('political' | 'economic' | 'military' | 'tech' | 'social' | 'energy')[]
  scenarios: ('baseline' | 'optimistic' | 'pessimistic')[]
  timeHorizon: '7d' | '30d' | '90d' | '1y'
  language?: string
}

const DOMAIN_PROMPTS: Record<string, string> = {
  political: `Analyze the political and diplomatic implications. Consider:
- Government stability and political risk
- International relations and alliances
- Diplomatic responses and negotiations
- Public opinion and media reaction
- Electoral/political consequences`,

  economic: `Analyze the economic and financial impacts. Consider:
- Markets, currency, and trade flows
- Sanctions and economic restrictions
- Investment climate and capital flows
- Inflation and economic growth
- Supply chain disruptions`,

  military: `Analyze the military and security implications. Consider:
- Military deployments and posture
- Escalation/de-escalation risks
- Defense capabilities and readiness
- Intelligence and counterintelligence
- Regional security dynamics`,

  tech: `Analyze the technology and cybersecurity implications. Consider:
- Cyber warfare and attacks
- Technology sanctions and restrictions
- Critical infrastructure vulnerability
- Data security and surveillance
- Tech industry impacts`,

  social: `Analyze the social and humanitarian implications. Consider:
- Civil unrest and protests
- Migration and refugee flows
- Human rights concerns
- Media and information warfare
- Public sentiment and morale`,

  energy: `Analyze the energy and resources implications. Consider:
- Energy supply and prices
- Resource security
- Infrastructure vulnerabilities
- Alternative energy sources
- Geopolitical leverage through resources`
}

const SCENARIO_DEFINITIONS = {
  baseline: 'Most likely outcome based on historical precedent and current trends',
  optimistic: 'Best reasonable case scenario — positive resolution or favorable developments',
  pessimistic: 'Worst reasonable case scenario — escalation, negative consequences, or crisis'
}

async function analyzeScenario(
  event: string,
  domain: string,
  scenario: 'baseline' | 'optimistic' | 'pessimistic',
  timeHorizon: string,
  signal?: AbortSignal
): Promise<ScenarioResult> {
  const domainPrompt = DOMAIN_PROMPTS[domain] || DOMAIN_PROMPTS.political
  const scenarioDef = SCENARIO_DEFINITIONS[scenario]

  const prompt = `You are an expert ${domain} analyst. Analyze the following event from a ${scenario} perspective.

EVENT: ${event}

TIME HORIZON: ${timeHorizon}

SCENARIO: ${scenario} (${scenarioDef})

ANALYSIS FRAMEWORK:
${domainPrompt}

Provide your analysis in the following JSON format:
{
  "description": "Detailed narrative of how this scenario unfolds (2-3 paragraphs)",
  "impacts": [
    {"impact": "Specific impact description", "severity": "low|medium|high|critical", "timeline": "When this impact occurs"}
  ],
  "cascadingEffects": ["List of secondary/tertiary effects that follow"]
}

Output ONLY valid JSON. Be specific and analytical.`

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: signal || undefined,
    body: JSON.stringify({
      modelId: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [
        { role: 'system', content: `You are an expert ${domain} analyst. Output ONLY valid JSON.` },
        { role: 'user', content: prompt }
      ],
      temperature: scenario === 'baseline' ? 0.3 : scenario === 'optimistic' ? 0.5 : 0.7,
      maxTokens: 2000,
      response_format: { type: 'json_object' }
    })
  })

  if (!res.ok) {
    throw new Error(`Analysis failed: ${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No reader')

  const decoder = new TextDecoder()
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }

  // Parse JSON response
  let analysis: any
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { description: text, impacts: [], cascadingEffects: [] }
  } catch {
    analysis = { description: text, impacts: [], cascadingEffects: [] }
  }

  return {
    scenario,
    probability: scenario === 'baseline' ? 0.6 : scenario === 'optimistic' ? 0.25 : 0.15,
    description: analysis.description || 'Analysis pending...',
    impacts: (analysis.impacts || []).map((i: any) => ({
      domain,
      impact: i.impact || 'Impact analysis pending',
      severity: i.severity || 'medium',
      timeline: i.timeline || 'Timeline pending'
    })),
    cascadingEffects: analysis.cascadingEffects || []
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as SimulationRequest
    const { event, domains, scenarios, timeHorizon } = body

    if (!event) {
      return Response.json({ error: 'Event description is required' }, { status: 400 })
    }

    const selectedDomains = domains || ['political', 'economic']
    const selectedScenarios = scenarios || ['baseline', 'pessimistic']

    console.log(`[EventSim] Analyzing: "${event.slice(0, 100)}..."`)
    console.log(`[EventSim] Domains: ${selectedDomains.join(', ')}, Scenarios: ${selectedScenarios.join(', ')}`)

    // Run all analyses in parallel
    const promises: Promise<ScenarioResult>[] = []

    for (const domain of selectedDomains) {
      for (const scenario of selectedScenarios) {
        promises.push(analyzeScenario(event, domain, scenario, timeHorizon))
      }
    }

    const results = await Promise.allSettled(promises)

    // Organize results
    const scenarioResults: ScenarioResult[] = []
    const errors: string[] = []

    for (const result of results) {
      if (result.status === 'fulfilled') {
        scenarioResults.push(result.value)
      } else {
        errors.push(result.reason?.message || 'Unknown error')
      }
    }

    // Generate summary
    const summary = {
      event,
      timeHorizon,
      domainsAnalyzed: selectedDomains,
      scenariosExplored: selectedScenarios,
      totalAnalyses: scenarioResults.length,
      successfulAnalyses: scenarioResults.length,
      failedAnalyses: errors.length,
      timestamp: new Date().toISOString()
    }

    return Response.json({
      success: errors.length === 0,
      summary,
      results: scenarioResults,
      errors: errors.length > 0 ? errors : undefined
    })

  } catch (error: any) {
    console.error('[EventSim] Error:', error)
    return Response.json({ error: error.message || 'Simulation failed' }, { status: 500 })
  }
}