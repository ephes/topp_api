import { FeedbackRepository } from '../db/FeedbackRepository'
import { PayloadError } from '../types/api'

class FeedbackApi {
    feedbackRepo: FeedbackRepository

    constructor(feedbackRepo: FeedbackRepository) {
        this.feedbackRepo = feedbackRepo
    }

    validateVote(
        episodeId: string | undefined,
        feedbackType: string | undefined
    ) {
        if (
            episodeId === undefined ||
            !/^\d+$/.test(episodeId) ||
            !Number.isSafeInteger(Number(episodeId)) ||
            Number(episodeId) < 0 ||
            (feedbackType !== 'upvote' && feedbackType !== 'downvote')
        ) {
            throw new PayloadError('Invalid feedback request')
        }
    }

    async handleApiPost(
        episodeId: string,
        userHash: string,
        feedbackType: string
    ) {
        this.validateVote(episodeId, feedbackType)
        return await this.feedbackRepo.addFeedback(
            1,
            Number(episodeId),
            userHash,
            feedbackType === 'upvote'
        )
    }

    // Warning! This expects the comment to be already sanitized
    handleCommentPost(episodeId: string, hash: string, comment: string) {
        return this.feedbackRepo.addComment(1, Number(episodeId), hash, comment)
    }

    getNumberOfComments(episodeId: string) {
        return this.feedbackRepo.getNumberOfComments(Number(episodeId))
    }
}

export { FeedbackApi }
