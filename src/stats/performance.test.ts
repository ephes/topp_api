import { describe, it, expect } from '@jest/globals'
import { calcApplePodcastPerformanceQuarters } from './performance'

const buildTestStructure = function (arr: number[]) {
    let counter = 0
    return arr.map((v) => {
        const ret: { [seconds: string]: number } = {}
        ret[String(++counter)] = v
        return ret
    })
}

describe('calculate quarterly performance data of an episode', () => {
    it('simplest case of 4 values', () => {
        const testdata = buildTestStructure([1, 2, 3, 4])
        const res = calcApplePodcastPerformanceQuarters(testdata)
        expect(res.maxListeners).toBe(4)
        expect(res.quarterMedianValues).toStrictEqual([1, 2, 3, 4])
    })

    it('complex case with 3 number per quarter', () => {
        const testdata = buildTestStructure([
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        ])
        const res = calcApplePodcastPerformanceQuarters(testdata)
        expect(res.maxListeners).toBe(12)
        expect(res.quarterMedianValues).toStrictEqual([2, 5, 8, 11])
    })

    it('only 3 values returns empty performance quarters', () => {
        expect(
            calcApplePodcastPerformanceQuarters(buildTestStructure([1, 2, 3]))
        ).toStrictEqual({ maxListeners: 0, quarterMedianValues: [0, 0, 0, 0] })
    })
})
