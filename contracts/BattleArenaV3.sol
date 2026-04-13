// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title Battle Arena V3
/// @notice Free match entry tracking with win/loss stats and streak-based NFT rewards.
contract BattleArenaV3 is ERC721 {
    uint256 public constant STREAK_TO_MINT = 3;
    string public constant PLACEHOLDER_TOKEN_URI =
        "https://example.com/battle-arena-v3/metadata.json";

    uint256 public totalEntries;
    uint256 public totalPlayers;
    uint256 public nextTokenId = 1;

    mapping(address => uint256) public entriesByPlayer;
    mapping(address => uint256) public lastEntryAt;
    mapping(bytes32 => uint256) public entriesByCharacter;
    mapping(address => uint256) public winsPerPlayer;
    mapping(address => uint256) public lossesPerPlayer;
    mapping(address => uint256) public winStreak;

    event MatchEntered(
        address indexed player,
        string characterId,
        bytes32 indexed characterHash,
        uint256 entryNumber,
        uint256 timestamp,
        bool won,
        uint256 winStreak
    );
    event RewardMinted(
        address indexed player,
        uint256 indexed tokenId,
        uint256 completedStreak
    );

    constructor() ERC721("Battle Arena Streak Reward", "BASR") {}

    /// @notice Enter a match with a character and self-reported result.
    function enterMatch(string calldata characterId, bool won) external {
        bytes32 characterHash = keccak256(bytes(characterId));

        if (entriesByPlayer[msg.sender] == 0) {
            totalPlayers += 1;
        }

        totalEntries += 1;
        entriesByPlayer[msg.sender] += 1;
        lastEntryAt[msg.sender] = block.timestamp;
        entriesByCharacter[characterHash] += 1;

        uint256 streakForEvent;
        if (won) {
            winsPerPlayer[msg.sender] += 1;
            streakForEvent = winStreak[msg.sender] + 1;
            winStreak[msg.sender] = streakForEvent;
        } else {
            lossesPerPlayer[msg.sender] += 1;
            winStreak[msg.sender] = 0;
            streakForEvent = 0;
        }

        emit MatchEntered(
            msg.sender,
            characterId,
            characterHash,
            totalEntries,
            block.timestamp,
            won,
            streakForEvent
        );

        if (won && streakForEvent == STREAK_TO_MINT) {
            _mintReward(msg.sender);
        }
    }

    /// @notice Get entry count for a character by id.
    function getCharacterEntries(
        string calldata characterId
    ) external view returns (uint256) {
        return entriesByCharacter[keccak256(bytes(characterId))];
    }

    /// @notice Get aggregated stats for a player.
    function getPlayerStats(
        address player
    )
        external
        view
        returns (
            uint256 entries,
            uint256 lastEntryTime,
            uint256 wins,
            uint256 losses,
            uint256 currentWinStreak
        )
    {
        return (
            entriesByPlayer[player],
            lastEntryAt[player],
            winsPerPlayer[player],
            lossesPerPlayer[player],
            winStreak[player]
        );
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return PLACEHOLDER_TOKEN_URI;
    }

    function _mintReward(address player) internal {
        uint256 tokenId = nextTokenId;
        nextTokenId += 1;

        // Reset before minting so a contract recipient cannot observe a stale streak during callbacks.
        winStreak[player] = 0;
        _safeMint(player, tokenId);

        emit RewardMinted(player, tokenId, STREAK_TO_MINT);
    }
}
