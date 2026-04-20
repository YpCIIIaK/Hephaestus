// Condition evaluation for chain branching

import { Condition } from './types'

export function evaluateCondition(condition: Condition, context: Record<string, any>): boolean {
  switch (condition.operator) {
    case 'and':
      return condition.conditions?.every(c => evaluateCondition(c, context)) ?? true
    
    case 'or':
      return condition.conditions?.some(c => evaluateCondition(c, context)) ?? false
    
    case 'not':
      return !evaluateCondition(condition.conditions?.[0] || { operator: 'and' }, context)
    
    default:
      // Field-based comparison
      if (condition.field) {
        return evaluateFieldCondition(condition, context)
      }
      return false
  }
}

function evaluateFieldCondition(condition: Condition, context: Record<string, any>): boolean {
  const { field, operatorType = 'eq', value } = condition
  
  if (!field) return false
  
  // Resolve field value from context
  const fieldValue = resolveFieldPath(field, context)
  
  switch (operatorType) {
    case 'eq':
      return fieldValue === value
    
    case 'neq':
      return fieldValue !== value
    
    case 'gt':
      return typeof fieldValue === 'number' && fieldValue > value
    
    case 'gte':
      return typeof fieldValue === 'number' && fieldValue >= value
    
    case 'lt':
      return typeof fieldValue === 'number' && fieldValue < value
    
    case 'lte':
      return typeof fieldValue === 'number' && fieldValue <= value
    
    case 'contains':
      if (typeof fieldValue === 'string') {
        return fieldValue.toLowerCase().includes(String(value).toLowerCase())
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.some(item => 
          String(item).toLowerCase().includes(String(value).toLowerCase())
        )
      }
      return false
    
    case 'starts_with':
      return typeof fieldValue === 'string' && 
        fieldValue.toLowerCase().startsWith(String(value).toLowerCase())
    
    case 'ends_with':
      return typeof fieldValue === 'string' && 
        fieldValue.toLowerCase().endsWith(String(value).toLowerCase())
    
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null
    
    case 'empty':
      return fieldValue === undefined || 
             fieldValue === null || 
             fieldValue === '' ||
             (Array.isArray(fieldValue) && fieldValue.length === 0)
    
    default:
      return false
  }
}

function resolveFieldPath(path: string, context: Record<string, any>): any {
  // Support dot notation: "result.status" or "previousResult.data.count"
  const parts = path.split('.')
  let value: any = context
  
  for (const part of parts) {
    if (value === undefined || value === null) {
      return undefined
    }
    value = value[part]
  }
  
  return value
}

// Build a simple condition from UI inputs
export function buildCondition(
  field: string,
  operator: Condition['operatorType'],
  value: any
): Condition {
  return {
    operator: 'and',
    conditions: [{
      operator: 'and',
      field,
      operatorType: operator,
      value
    }]
  }
}

// Parse condition from string expression
export function parseConditionExpression(expression: string): Condition | null {
  // Support simple expressions like:
  // "status === 'success'"
  // "count > 5"
  // "name contains 'test'"
  
  const patterns = [
    // Field === 'value' or Field == "value"
    { regex: /^(\w+)\s*===?\s*['"](.+)['"]$/i, operator: 'eq' as const },
    // Field !== 'value'
    { regex: /^(\w+)\s*!==?\s*['"](.+)['"]$/i, operator: 'neq' as const },
    // Field > value
    { regex: /^(\w+)\s*>\s*(\d+(?:\.\d+)?)$/i, operator: 'gt' as const },
    // Field >= value
    { regex: /^(\w+)\s*>=\s*(\d+(?:\.\d+)?)$/i, operator: 'gte' as const },
    // Field < value
    { regex: /^(\w+)\s*<\s*(\d+(?:\.\d+)?)$/i, operator: 'lt' as const },
    // Field <= value
    { regex: /^(\w+)\s*<=\s*(\d+(?:\.\d+)?)$/i, operator: 'lte' as const },
    // Field contains 'value'
    { regex: /^(\w+)\s+contains\s+['"](.+)['"]$/i, operator: 'contains' as const },
  ]
  
  for (const pattern of patterns) {
    const match = expression.trim().match(pattern.regex)
    if (match) {
      const field = match[1]
      const rawValue = match[2]
      
      // Try to parse as number
      const value = /^(\d+(?:\.\d+)?)$/.test(rawValue) ? parseFloat(rawValue) : rawValue
      
      return {
        operator: 'and',
        conditions: [{
          operator: 'and',
          field,
          operatorType: pattern.operator,
          value
        }]
      }
    }
  }
  
  return null
}
