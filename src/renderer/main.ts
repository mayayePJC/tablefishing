import { Game } from './core/Game'

const game = new Game()
game.start()

// 暴露给控制台调试
;(window as unknown as { game: Game }).game = game
