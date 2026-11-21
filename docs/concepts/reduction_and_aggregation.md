# Reduction and Aggregation in Computing (Especially with Data)

**Reduction** and **aggregation** are related ways of turning many data values into fewer (often one or a small number of) summary values. They appear across databases, data processing frameworks, functional programming, and parallel computing.

## Aggregation

Aggregation means **grouping data and computing summary statistics** over those groups.

Typical operations:
- `COUNT`, `SUM`, `AVG` / mean, `MIN`, `MAX`
- Sometimes more advanced ones (median, percentile, standard deviation, etc.)

It almost always involves an explicit or implicit **GROUP BY**.

### Examples

**SQL:**
```sql
SELECT department, AVG(salary), COUNT(*)
FROM employees
GROUP BY department;
```

**pandas:**
```python
df.groupby("department")["salary"].agg(["mean", "count"])
```

Data warehouses, Spark, BigQuery, etc., all treat aggregation the same way: partition by key(s), then apply one or more aggregate functions.

Aggregation is the everyday term in databases, analytics, and business intelligence.

## Reduction

Reduction is a more general idea: **combining a collection of values into a single value** using a binary (or associative) operator.

Classic reductions:
- Sum of numbers
- Product
- Maximum / minimum
- Logical AND / OR
- Concatenation of strings
- Building a histogram or set

Key properties often required (especially for parallel or distributed use):
- The operator is **associative** (and preferably commutative) so the work can be split and recombined in any order.

### Examples

**Functional programming (`reduce` / `fold`):**
```python
from functools import reduce
reduce(lambda a, b: a + b, [1, 2, 3, 4])  # → 10
```

**Parallel / distributed computing (MapReduce, MPI, CUDA, Spark):**
- Map phase emits intermediate key-value pairs
- Reduce phase combines all values that share the same key into one result

**Array languages and numerical computing:**
- Reductions along an axis (e.g. `np.sum(array, axis=0)`)

In MapReduce and many big-data systems, the “reduce” step is exactly this combining operation.

## How They Relate

| Aspect              | Aggregation                          | Reduction                              |
|---------------------|--------------------------------------|----------------------------------------|
| Typical scope       | Groups + summary statistics          | Any combining of many → one            |
| Common contexts     | SQL, pandas, BI tools, data warehouses | Functional programming, MapReduce, parallel algorithms, numerical computing |
| Grouping            | Usually explicit (`GROUP BY`)        | Implicit (by key) or absent            |
| Operators           | SUM, AVG, COUNT, MIN, MAX, …         | Any associative operator               |
| Overlap             | Most aggregations *are* reductions   | Not every reduction is called an aggregation |

### In practice
- Database people say “aggregation.”
- Functional programmers and systems people say “reduction” or “reduce.”
- In Spark, Hadoop, etc., you often see both terms used for essentially the same idea.

### Simple mental model
- **Aggregation** = reduction applied after grouping (and usually producing familiar summary statistics).
- **Reduction** = the more fundamental combining operation that aggregation is built on.

Both exist because computing with large amounts of data almost always requires collapsing many values into a smaller, useful result.
